import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

type ViewKind = "run" | "game" | "llm" | "compare" | "macro" | "question-families" | "confidence";
type OutputFormat = "text" | "json";

interface RunMeta {
  runId: string;
  strategyName?: string;
  policyName?: string;
  protocolName?: string;
  beliefKind?: string;
  boardIds?: string[];
  seedCount?: number;
  particleCount?: number;
  epsilon?: number;
  model?: string;
  label?: string;
  startedAt?: string;
  command?: string;
  outputDir?: string;
}

interface RunSummary {
  finishedAt?: string;
  games?: number;
  avgF1?: number;
  avgShots?: number;
  avgQuestions?: number;
  avgHits?: number;
  avgMisses?: number;
  wins?: number;
  winRate?: number;
  runtimeSeconds?: number;
  status?: string;
  errorMessage?: string;
  llmTurns?: number;
  llmRate?: number;
  autoDecidedTurns?: number;
  fallbackTurns?: number;
  outputDir?: string;
}

interface GameRow {
  runId: string;
  gameId: string;
  gameIndex?: number;
  seedIndex?: number;
  status?: string;
  boardId: string;
  seed: number;
  strategyName?: string;
  policyName?: string;
  shotsFired?: number;
  questionsAsked?: number;
  hitCount?: number;
  missCount?: number;
  totalShipCells?: number;
  targetingF1?: number;
  won?: boolean;
}

interface EventRow {
  runId: string;
  gameId: string;
  boardId: string;
  seed: number;
  seedIndex: number;
  turn: number;
  source: string;
  type: string;
  snapshot?: Record<string, unknown>;
  data?: Record<string, unknown> | string | number | boolean | null;
  index: number;
  loggedAt: string;
}

interface LoadedRun {
  dir: string;
  meta: RunMeta;
  summary?: RunSummary;
  games: GameRow[];
  events?: EventRow[];
}

interface TurnLens {
  turn: number;
  snapshot?: Record<string, unknown>;
  pipelineStages?: Array<{
    stage?: string | null;
    status?: string | null;
    proposalKind?: string | null;
    metadata?: unknown;
  }>;
  pipelineFallbacks?: Array<{
    stage?: string | null;
    reason?: string | null;
    metadata?: unknown;
  }>;
  gate?: {
    usedLLM?: boolean;
    reason?: string;
    valueGap?: number | null;
    bestShootCell?: string | null;
    bestQuestionId?: string | null;
  };
  llm?: {
    model?: string | null;
    status?: string;
    latencyMs?: number;
    decisionAction?: string | null;
    decisionCellId?: string | null;
    decisionQuestionId?: string | null;
    decisionRevisionKind?: string | null;
    decisionQuestionSource?: string | null;
    decisionQuestionSpec?: unknown;
    decisionReason?: string | null;
    explanationStatus?: string | null;
    explanationLatencyMs?: number | null;
    explanation?: string | null;
    errorMessage?: string | null;
  };
  final?: {
    source?: string;
    action?: string;
    cellId?: string | null;
    questionId?: string | null;
    questionSource?: string | null;
    questionSpec?: unknown;
  };
  result?: {
    kind: "shot" | "question";
    cellId?: string | null;
    isHit?: boolean;
    questionId?: string | null;
    questionSource?: string | null;
    questionSpec?: unknown;
    answer?: boolean;
  };
}

const RESULTS_ROOT = resolve("results/runs");

const cliArgs = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));

const { values } = parseArgs({
  args: cliArgs,
  options: {
    run: { type: "string", default: "latest" },
    view: { type: "string", default: "run" },
    "compare-run": { type: "string" },
    game: { type: "string" },
    board: { type: "string" },
    "seed-index": { type: "string" },
    "max-items": { type: "string", default: "5" },
    "max-turns": { type: "string", default: "20" },
    format: { type: "string", default: "text" },
  },
});

async function main(): Promise<void> {
  const view = parseView(values.view);
  const format = parseFormat(values.format);
  const maxItems = parsePositiveInt(values["max-items"], 5);
  const maxTurns = parsePositiveInt(values["max-turns"], 20);

  if (view === "compare") {
    if (!values["compare-run"]) {
      throw new Error("--compare-run is required for --view compare");
    }

    const primary = loadRun(values.run!, false);
    const baseline = loadRun(values["compare-run"]!, false);
    emit(format, renderCompareView(primary, baseline, maxItems));
    return;
  }

  let run = loadRun(
    values.run!,
    view === "game" || view === "llm" || view === "macro" || view === "question-families" || view === "confidence",
  );
  if (view === "run" && !run.summary) {
    run = loadRun(values.run!, true);
  }

  if (view === "run") {
    emit(format, renderRunView(run, maxItems));
    return;
  }

  if (view === "game") {
    const game = resolveGame(run, values.game, values.board, values["seed-index"]);
    emit(format, renderGameView(run, game.gameId, maxTurns));
    return;
  }

  if (view === "macro") {
    const game = resolveGame(run, values.game, values.board, values["seed-index"]);
    emit(format, renderMacroView(run, game.gameId, maxTurns));
    return;
  }

  if (view === "confidence") {
    emit(format, renderConfidenceView(run, values.game, values.board, values["seed-index"], maxItems, maxTurns));
    return;
  }

  if (view === "question-families") {
    emit(format, renderQuestionFamilyView(run, values.game, values.board, values["seed-index"], maxItems));
    return;
  }

  emit(format, renderLLMView(run, values.game, values.board, values["seed-index"], maxItems, maxTurns));
}

function loadRun(runRef: string, withEvents: boolean): LoadedRun {
  const dir = resolveRunDir(runRef);
  const meta = readJson<RunMeta>(resolve(dir, "run.json"));
  const summary = maybeReadJson<RunSummary>(resolve(dir, "summary.json"));
  const games = maybeReadJsonLines<GameRow>(resolve(dir, "games.jsonl"));
  const events = withEvents ? maybeReadJsonLines<EventRow>(resolve(dir, "events.jsonl")) : undefined;

  return { dir, meta, summary, games, events };
}

function renderRunView(run: LoadedRun, maxItems: number): object | string {
  const totalExpectedGames = (run.meta.boardIds?.length ?? 0) * (run.meta.seedCount ?? 0);
  const effectiveSummary = summarizeRun(run);
  const boardRows = summarizeBoards(run.games);
  const bestBoards = boardRows.slice(0, maxItems);
  const worstBoards = [...boardRows].reverse().slice(0, maxItems).reverse();
  const worstGames = [...run.games]
    .sort((a, b) => (a.targetingF1 ?? 0) - (b.targetingF1 ?? 0))
    .slice(0, maxItems);

  return {
    view: "run",
    runId: run.meta.runId,
    dir: run.dir,
    status: effectiveSummary.status,
    strategy: run.meta.strategyName ?? null,
    policy: run.meta.policyName ?? null,
    protocol: run.meta.protocolName ?? null,
    belief: run.meta.beliefKind ?? null,
    model: run.meta.model ?? null,
    particles: run.meta.particleCount ?? null,
    epsilon: run.meta.epsilon ?? null,
    completedGames: run.games.length,
    expectedGames: totalExpectedGames || null,
    avgF1: effectiveSummary.avgF1,
    avgShots: effectiveSummary.avgShots ?? null,
    avgQuestions: effectiveSummary.avgQuestions ?? null,
    wins: effectiveSummary.wins,
    winRate: effectiveSummary.winRate,
    runtimeSeconds: effectiveSummary.runtimeSeconds ?? null,
    llmTurns: effectiveSummary.llmTurns,
    llmRate: effectiveSummary.llmRate ?? null,
    autoDecidedTurns: effectiveSummary.autoDecidedTurns,
    fallbackTurns: effectiveSummary.fallbackTurns,
    bestBoards,
    worstBoards,
    worstGames,
  };
}

function renderGameView(run: LoadedRun, gameId: string, maxTurns: number): object | string {
  const events = requireEvents(run).filter((event) => event.gameId === gameId);
  if (events.length === 0) {
    throw new Error(`No events found for game ${gameId}`);
  }

  const game = findGame(run.games, gameId) ?? inferGameFromEvents(events);
  const turns = buildTurnLens(events);
  const counters = summarizeTurnCounters(turns);

  return {
    view: "game",
    runId: run.meta.runId,
    gameId,
    boardId: game.boardId,
    seedIndex: game.seedIndex ?? null,
    result: {
      status: game.status ?? null,
      won: game.won ?? null,
      targetingF1: game.targetingF1 ?? null,
      shotsFired: game.shotsFired ?? null,
      questionsAsked: game.questionsAsked ?? null,
      hitCount: game.hitCount ?? null,
      missCount: game.missCount ?? null,
    },
    counters,
    turns: turns.slice(0, maxTurns).map(renderTurnRow),
    truncated: turns.length > maxTurns ? turns.length - maxTurns : 0,
  };
}

function renderLLMView(
  run: LoadedRun,
  gameId: string | undefined,
  boardId: string | undefined,
  seedIndexRaw: string | undefined,
  maxItems: number,
  maxTurns: number,
): object | string {
  const events = requireEvents(run);
  const seedIndex = seedIndexRaw === undefined ? undefined : parsePositiveInt(seedIndexRaw, 0);
  const filteredEvents = events.filter((event) => {
    if (gameId && event.gameId !== gameId) return false;
    if (boardId && event.boardId !== boardId) return false;
    if (seedIndex !== undefined && event.seedIndex !== seedIndex) return false;
    return true;
  });

  const grouped = new Map<string, EventRow[]>();
  for (const event of filteredEvents) {
    const rows = grouped.get(event.gameId) ?? [];
    rows.push(event);
    grouped.set(event.gameId, rows);
  }

  const llmTurns = [...grouped.entries()]
    .flatMap(([currentGameId, rows]) =>
      buildTurnLens(rows)
        .filter((turn) => turn.gate?.usedLLM === true || turn.llm !== undefined)
        .map((turn) => ({
          gameId: currentGameId,
          boardId: rows[0]?.boardId ?? null,
          ...renderTurnRow(turn),
        })),
    )
    .sort((a, b) => {
      const gameCompare = String(a.gameId).localeCompare(String(b.gameId));
      if (gameCompare !== 0) return gameCompare;
      return asNumber(a.turn) - asNumber(b.turn);
    });

  const turns = llmTurns.slice(0, maxTurns);
  const latencies = llmTurns
    .map((turn) => asNullableNumber(turn.llmLatencyMs))
    .filter((value): value is number => typeof value === "number");
  const byGame = summarizeLLMByGame(filteredEvents)
    .sort((a, b) => b.llmTurns - a.llmTurns)
    .slice(0, maxItems);

  return {
    view: "llm",
    runId: run.meta.runId,
    filter: {
      gameId: gameId ?? null,
      boardId: boardId ?? null,
      seedIndex: seedIndex ?? null,
    },
    totalLLMTurns: llmTurns.length,
    avgLatencyMs: latencies.length > 0 ? mean(latencies) : null,
    p95LatencyMs: latencies.length > 0 ? percentile(latencies, 0.95) : null,
    byGame,
    turns,
    truncated: llmTurns.length > maxTurns
      ? llmTurns.length - maxTurns
      : 0,
  };
}

function renderMacroView(run: LoadedRun, gameId: string, maxTurns: number): object | string {
  const events = requireEvents(run).filter((event) => event.gameId === gameId);
  if (events.length === 0) {
    throw new Error(`No events found for game ${gameId}`);
  }

  const turns = buildTurnLens(events).map((turn) => ({
    turn: turn.turn,
    bestHitProb: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestHitProb"])) : null,
    top2HitGap: turn.snapshot ? asNumber(readNested(turn.snapshot, ["top2HitGap"])) : null,
    posteriorEntropy: turn.snapshot ? asNumber(readNested(turn.snapshot, ["posteriorEntropy"])) : null,
    frontierCellCount: turn.snapshot ? asNumber(readNested(turn.snapshot, ["frontierCellCount"])) : null,
    recentQuestionROI: turn.snapshot ? asNumber(readNested(turn.snapshot, ["recentQuestionROI"])) : null,
    bestMacroPlanKind: turn.snapshot ? asString(readNested(turn.snapshot, ["bestMacroPlanKind"])) : null,
    bestMacroPlanValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestMacroPlanValue"])) : null,
    probePlanValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestProbePlanValue"])) : null,
    exploitPlanValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestExploitPlanValue"])) : null,
    closeoutPlanValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestCloseoutPlanValue"])) : null,
    macroPlanGap: turn.snapshot ? asNumber(readNested(turn.snapshot, ["macroPlanGap"])) : null,
    macroExplorePreferred: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["macroExplorePreferred"])) : null,
    macroExploitPreferred: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["macroExploitPreferred"])) : null,
    gateReason: turn.gate?.reason ?? null,
    finalAction: turn.final?.action ?? null,
  }));

  return {
    view: "macro",
    runId: run.meta.runId,
    gameId,
    turns: turns.slice(0, maxTurns),
    truncated: turns.length > maxTurns ? turns.length - maxTurns : 0,
  };
}

function renderQuestionFamilyView(
  run: LoadedRun,
  gameId: string | undefined,
  boardId: string | undefined,
  seedIndexRaw: string | undefined,
  maxItems: number,
): object | string {
  const events = requireEvents(run);
  const seedIndex = seedIndexRaw === undefined ? undefined : parsePositiveInt(seedIndexRaw, 0);
  const filteredEvents = events.filter((event) => {
    if (gameId && event.gameId !== gameId) return false;
    if (boardId && event.boardId !== boardId) return false;
    if (seedIndex !== undefined && event.seedIndex !== seedIndex) return false;
    return true;
  });

  const latestByGame = new Map<string, EventRow>();
  for (const event of filteredEvents) {
    if (event.snapshot) {
      latestByGame.set(event.gameId, event);
    }
  }

  const rows = [...latestByGame.values()]
    .map((event) => {
      const snapshot = event.snapshot ?? {};
      return {
        gameId: event.gameId,
        boardId: event.boardId,
        seedIndex: event.seedIndex,
        coarseQuestionsUsed: asNumber(readNested(snapshot, ["coarseQuestionsUsed"])) ?? 0,
        localQuestionsUsed: asNumber(readNested(snapshot, ["localQuestionsUsed"])) ?? 0,
        lateQuestionsUsed: asNumber(readNested(snapshot, ["lateQuestionsUsed"])) ?? 0,
        recentQuestionROI: asNumber(readNested(snapshot, ["recentQuestionROI"])) ?? null,
        bestMacroPlanKind: asString(readNested(snapshot, ["bestMacroPlanKind"])) ?? null,
      };
    })
    .sort((a, b) =>
      (b.coarseQuestionsUsed + b.localQuestionsUsed + b.lateQuestionsUsed) -
      (a.coarseQuestionsUsed + a.localQuestionsUsed + a.lateQuestionsUsed)
    );

  return {
    view: "question-families",
    runId: run.meta.runId,
    rows: rows.slice(0, maxItems),
    truncated: rows.length > maxItems ? rows.length - maxItems : 0,
  };
}

function renderConfidenceView(
  run: LoadedRun,
  gameId: string | undefined,
  boardId: string | undefined,
  seedIndexRaw: string | undefined,
  maxItems: number,
  maxTurns: number,
): object | string {
  const events = requireEvents(run);
  const seedIndex = seedIndexRaw === undefined ? undefined : parsePositiveInt(seedIndexRaw, 0);
  const filteredEvents = events.filter((event) => {
    if (gameId && event.gameId !== gameId) return false;
    if (boardId && event.boardId !== boardId) return false;
    if (seedIndex !== undefined && event.seedIndex !== seedIndex) return false;
    return true;
  });

  const grouped = new Map<string, EventRow[]>();
  for (const event of filteredEvents) {
    const rows = grouped.get(event.gameId) ?? [];
    rows.push(event);
    grouped.set(event.gameId, rows);
  }

  if (gameId || boardId) {
    const resolvedGameId = gameId ?? resolveGame(run, gameId, boardId, seedIndexRaw).gameId;
    const rows = buildConfidenceLens(grouped.get(resolvedGameId) ?? []);
    return {
      view: "confidence",
      runId: run.meta.runId,
      gameId: resolvedGameId,
      turns: rows.slice(0, maxTurns),
      truncated: rows.length > maxTurns ? rows.length - maxTurns : 0,
    };
  }

  const byGame = [...grouped.entries()]
    .map(([currentGameId, rows]) => {
      const turns = buildConfidenceLens(rows);
      const observations = turns.filter((turn) => turn.observation !== null);
      const revisions = turns.filter((turn) => turn.revisionReason !== null).length;
      const confidences = turns
        .map((turn) => turn.modelConfidence)
        .filter((value): value is number => typeof value === "number");
      const lowConfidenceTurns = turns.filter((turn) => turn.needRevision === true).length;
      return {
        gameId: currentGameId,
        boardId: rows[0]?.boardId ?? null,
        avgConfidence: confidences.length > 0 ? round(mean(confidences)) : null,
        lowConfidenceTurns,
        revisions,
        observedTurns: observations.length,
      };
    })
    .sort((a, b) => asNumber(a.avgConfidence) - asNumber(b.avgConfidence))
    .slice(0, maxItems);

  return {
    view: "confidence",
    runId: run.meta.runId,
    byGame,
    truncated: grouped.size > maxItems ? grouped.size - maxItems : 0,
  };
}

function renderCompareView(primary: LoadedRun, baseline: LoadedRun, maxItems: number): object | string {
  const primarySummary = summarizeRun(primary);
  const baselineSummary = summarizeRun(baseline);
  const pairs = pairGames(primary.games, baseline.games);
  const boardRows = compareBoards(primary.games, baseline.games);

  return {
    view: "compare",
    primary: summarizeRunHeader(primary, primarySummary),
    baseline: summarizeRunHeader(baseline, baselineSummary),
    matchedGames: pairs.length,
    delta: {
      avgF1: round((primarySummary.avgF1 ?? 0) - (baselineSummary.avgF1 ?? 0)),
      avgShots: round((primarySummary.avgShots ?? 0) - (baselineSummary.avgShots ?? 0)),
      avgQuestions: round((primarySummary.avgQuestions ?? 0) - (baselineSummary.avgQuestions ?? 0)),
      wins: (primarySummary.wins ?? 0) - (baselineSummary.wins ?? 0),
      winRate: round((primarySummary.winRate ?? 0) - (baselineSummary.winRate ?? 0)),
      runtimeSeconds: round((primarySummary.runtimeSeconds ?? 0) - (baselineSummary.runtimeSeconds ?? 0)),
      llmTurns: (primarySummary.llmTurns ?? 0) - (baselineSummary.llmTurns ?? 0),
      llmRate: round((primarySummary.llmRate ?? 0) - (baselineSummary.llmRate ?? 0)),
    },
    bestBoardDeltas: boardRows.slice(0, maxItems),
    worstBoardDeltas: [...boardRows].reverse().slice(0, maxItems).reverse(),
  };
}

function summarizeRun(run: LoadedRun): RunSummary {
  if (run.summary) {
    const totalTurns = computeTotalTurns(run.games);
    return {
      ...run.summary,
      llmRate: totalTurns > 0 ? (run.summary.llmTurns ?? 0) / totalTurns : 0,
    };
  }

  const games = run.games;
  const wins = games.filter((game) => game.won).length;
  const avgF1 = games.length > 0 ? mean(games.map((game) => game.targetingF1 ?? 0)) : 0;
  const avgShots = games.length > 0 ? mean(games.map((game) => game.shotsFired ?? 0)) : 0;
  const avgQuestions = games.length > 0 ? mean(games.map((game) => game.questionsAsked ?? 0)) : 0;
  let llmTurns = 0;
  let autoDecidedTurns = 0;
  let fallbackTurns = 0;

  for (const event of run.events ?? []) {
    if (event.type === "gate_decision" && isRecord(event.data)) {
      if (event.data.usedLLM === true) llmTurns += 1;
      if (event.data.usedLLM === false) autoDecidedTurns += 1;
    }
    if (event.type === "reflective_llm_revision_requested") {
      llmTurns += 1;
    }
    if (event.type === "fallback") fallbackTurns += 1;
  }

  const totalTurns = computeTotalTurns(games);

  return {
    status: "in-progress",
    games: games.length,
    avgF1,
    avgShots,
    avgQuestions,
    wins,
    winRate: games.length > 0 ? wins / games.length : 0,
    llmTurns,
    llmRate: totalTurns > 0 ? llmTurns / totalTurns : 0,
    autoDecidedTurns,
    fallbackTurns,
  };
}

function summarizeRunHeader(run: LoadedRun, summary: RunSummary): object {
  return {
    runId: run.meta.runId,
    strategy: run.meta.strategyName ?? null,
    policy: run.meta.policyName ?? null,
    protocol: run.meta.protocolName ?? null,
    belief: run.meta.beliefKind ?? null,
    particles: run.meta.particleCount ?? null,
    epsilon: run.meta.epsilon ?? null,
    avgF1: summary.avgF1 ?? null,
    avgShots: summary.avgShots ?? null,
    avgQuestions: summary.avgQuestions ?? null,
    wins: summary.wins ?? null,
    winRate: summary.winRate ?? null,
    runtimeSeconds: summary.runtimeSeconds ?? null,
    llmTurns: summary.llmTurns ?? null,
    llmRate: summary.llmRate ?? null,
  };
}

function computeTotalTurns(games: GameRow[]): number {
  return games.reduce(
    (sum, game) => sum + (game.shotsFired ?? 0) + (game.questionsAsked ?? 0),
    0,
  );
}

function summarizeBoards(games: GameRow[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, GameRow[]>();
  for (const game of games) {
    const rows = grouped.get(game.boardId) ?? [];
    rows.push(game);
    grouped.set(game.boardId, rows);
  }

  return [...grouped.entries()]
    .map(([boardId, rows]) => ({
      boardId,
      games: rows.length,
      wins: rows.filter((row) => row.won).length,
      avgF1: round(mean(rows.map((row) => row.targetingF1 ?? 0))),
      avgShots: round(mean(rows.map((row) => row.shotsFired ?? 0))),
      avgQuestions: round(mean(rows.map((row) => row.questionsAsked ?? 0))),
    }))
    .sort((a, b) => asNumber(b.avgF1) - asNumber(a.avgF1));
}

function compareBoards(primaryGames: GameRow[], baselineGames: GameRow[]): Array<Record<string, unknown>> {
  const primary = summarizeBoards(primaryGames);
  const baseline = new Map<string, Record<string, unknown>>(
    summarizeBoards(baselineGames).map((row) => [String(row.boardId), row]),
  );

  return primary
    .filter((row) => baseline.has(String(row.boardId)))
    .map((row) => {
      const base = baseline.get(String(row.boardId))!;
      return {
        boardId: row.boardId,
        primaryAvgF1: row.avgF1,
        baselineAvgF1: base.avgF1,
        deltaF1: round(asNumber(row.avgF1) - asNumber(base.avgF1)),
        primaryWins: row.wins,
        baselineWins: base.wins,
      };
    })
    .sort((a, b) => asNumber(b.deltaF1) - asNumber(a.deltaF1));
}

function pairGames(primaryGames: GameRow[], baselineGames: GameRow[]): Array<[GameRow, GameRow]> {
  const baseline = new Map<string, GameRow>();
  for (const game of baselineGames) {
    baseline.set(gameKey(game), game);
  }

  const pairs: Array<[GameRow, GameRow]> = [];
  for (const game of primaryGames) {
    const match = baseline.get(gameKey(game));
    if (match) pairs.push([game, match]);
  }
  return pairs;
}

function buildTurnLens(events: EventRow[]): TurnLens[] {
  const turns = new Map<number, TurnLens>();

  for (const event of events) {
    const row = turns.get(event.turn) ?? { turn: event.turn };
    if (event.snapshot) {
      row.snapshot = event.snapshot;
    }

    if (event.type === "pipeline_stage" && isRecord(event.data)) {
      const items = row.pipelineStages ?? [];
      items.push({
        stage: asString(event.data.stage) ?? null,
        status: asString(event.data.status) ?? null,
        proposalKind: asString(event.data.proposalKind) ?? null,
        metadata: readNested(event.data, ["metadata"]) ?? null,
      });
      row.pipelineStages = items;
    }

    if (event.type === "pipeline_fallback" && isRecord(event.data)) {
      const items = row.pipelineFallbacks ?? [];
      items.push({
        stage: asString(event.data.stage) ?? null,
        reason: asString(event.data.reason) ?? null,
        metadata: readNested(event.data, ["metadata"]) ?? null,
      });
      row.pipelineFallbacks = items;
    }

    if (event.type === "gate_decision" && isRecord(event.data)) {
      row.gate = {
        usedLLM: asBoolean(event.data.usedLLM),
        reason: asString(event.data.reason),
        valueGap: asNullableNumber(event.data.valueGap),
        bestShootCell: asString(readNested(event.data, ["bestShoot", "cell"])),
        bestQuestionId: asString(readNested(event.data, ["bestQuestion", "id"])),
      };
    }

    if (event.type === "llm_effect_resolved" && isRecord(event.data)) {
      row.llm = {
        model: asString(event.data.model),
        status: asString(event.data.status) ?? asString(readNested(event.snapshot, ["llmStatus"])),
        latencyMs: asNumber(event.data.latencyMs) ?? asNumber(readNested(event.snapshot, ["llmLatencyMs"])),
        decisionAction: asString(event.data.decisionAction),
        decisionCellId: asString(event.data.decisionCellId),
        decisionQuestionId: asString(event.data.decisionQuestionId),
        decisionRevisionKind: asString(event.data.decisionRevisionKind),
        decisionQuestionSource: asString(event.data.decisionQuestionSource),
        decisionQuestionSpec: readNested(event.data, ["decisionQuestionSpec"]) ?? null,
        decisionReason: asString(event.data.decisionReason) ?? asString(event.data.why),
        errorMessage: asString(event.data.errorMessage),
      };
    }

    if (event.type === "llm_explanation_resolved" && isRecord(event.data)) {
      row.llm = {
        ...row.llm,
        explanationStatus: asString(event.data.status),
        explanationLatencyMs: asNullableNumber(event.data.latencyMs),
        decisionReason: asString(event.data.decisionReason) ?? row.llm?.decisionReason ?? null,
        explanation: asString(event.data.explanation),
        errorMessage: asString(event.data.errorMessage) ?? row.llm?.errorMessage ?? null,
      };
    }

    if (event.type === "final_decision" && isRecord(event.data)) {
      row.final = {
        source: asString(event.data.source),
        action: asString(event.data.action),
        cellId: asString(event.data.cellId),
        questionId: asString(event.data.questionId),
        questionSource: asString(event.data.questionSource),
        questionSpec: readNested(event.data, ["questionSpec"]) ?? null,
      };
    }

    if (event.type === "shot_result" && isRecord(event.data)) {
      row.result = {
        kind: "shot",
        cellId: asString(event.data.cellId),
        isHit: asBoolean(event.data.isHit),
      };
    }

    if (event.type === "question_result" && isRecord(event.data)) {
      row.result = {
        kind: "question",
        questionId: asString(event.data.id),
        questionSource: asString(event.data.source),
        questionSpec: readNested(event.data, ["questionSpec"]) ?? null,
        answer: asBoolean(event.data.answer),
      };
    }

    turns.set(event.turn, row);
  }

  return [...turns.values()].sort((a, b) => a.turn - b.turn);
}

function buildConfidenceLens(events: EventRow[]): Array<Record<string, unknown>> {
  const turns = new Map<number, Record<string, unknown>>();

  for (const event of events) {
    const row = turns.get(event.turn) ?? {
      turn: event.turn,
      predictedActionKind: null,
      predictedActionTarget: null,
      predictedHitProb: null,
      predictedAnswerProb: null,
      predictedQuestionValue: null,
      predictedGain: null,
      observedSignal: null,
      realizedGain: null,
      predictionErrorEMA: null,
      calibrationErrorEMA: null,
      lowConfidenceStreak: null,
      recentHighProbMissStreak: null,
      recentQuestionFailureStreak: null,
      exploitLockStreak: null,
      modelConfidence: null,
      needRevision: null,
      sustainedLowConfidence: null,
      allowLooseCoarseRevision: null,
      policyMode: null,
      revisionReason: null,
      lastRevisionDelta: null,
      currentPolicyPreviewValue: null,
      coarseCollapsePreviewValue: null,
      lateDiffusePreviewValue: null,
      clusterCloseoutPreviewValue: null,
      reopenLocalProbePreviewValue: null,
      confidenceCollapseReprobePreviewValue: null,
      reopenLocalProbeDelta: null,
      confidenceCollapseReprobeDelta: null,
      bestRevisionKind: null,
      bestRevisionDelta: null,
      positiveRevisionPreview: null,
      coarseBudget: null,
      localBudget: null,
      lateBudget: null,
      salvageStartTurn: null,
      exploitThreshold: null,
      questionFamilyMode: null,
      questionBudgetOpen: null,
      preferQuestion: null,
      preferExploitShot: null,
      nextRevisionKind: null,
      revisionRequested: null,
      appliedRevisionSource: null,
      llmRevisionUsed: null,
      llmRevisionFallback: null,
      observation: null,
    };

    if (event.snapshot) {
      row.predictionErrorEMA = asNullableNumber(readNested(event.snapshot, ["predictionErrorEMA"])) ?? row.predictionErrorEMA;
      row.calibrationErrorEMA = asNullableNumber(readNested(event.snapshot, ["calibrationErrorEMA"])) ?? row.calibrationErrorEMA;
      row.lowConfidenceStreak = asNullableNumber(readNested(event.snapshot, ["lowConfidenceStreak"])) ?? row.lowConfidenceStreak;
      row.recentHighProbMissStreak = asNullableNumber(readNested(event.snapshot, ["recentHighProbMissStreak"])) ?? row.recentHighProbMissStreak;
      row.recentQuestionFailureStreak = asNullableNumber(readNested(event.snapshot, ["recentQuestionFailureStreak"])) ?? row.recentQuestionFailureStreak;
      row.exploitLockStreak = asNullableNumber(readNested(event.snapshot, ["exploitLockStreak"])) ?? row.exploitLockStreak;
      row.modelConfidence = asNullableNumber(readNested(event.snapshot, ["modelConfidence"])) ?? row.modelConfidence;
      row.needRevision = asBoolean(readNested(event.snapshot, ["needRevision"])) ?? row.needRevision;
      row.sustainedLowConfidence = asBoolean(readNested(event.snapshot, ["sustainedLowConfidence"])) ?? row.sustainedLowConfidence;
      row.allowLooseCoarseRevision = asBoolean(readNested(event.snapshot, ["allowLooseCoarseRevision"])) ?? row.allowLooseCoarseRevision;
      row.policyMode = asString(readNested(event.snapshot, ["policyMode"])) ?? row.policyMode;
      row.currentPolicyPreviewValue = asNullableNumber(readNested(event.snapshot, ["currentPolicyPreviewValue"])) ?? row.currentPolicyPreviewValue;
      row.coarseCollapsePreviewValue = asNullableNumber(readNested(event.snapshot, ["coarseCollapsePreviewValue"])) ?? row.coarseCollapsePreviewValue;
      row.lateDiffusePreviewValue = asNullableNumber(readNested(event.snapshot, ["lateDiffusePreviewValue"])) ?? row.lateDiffusePreviewValue;
      row.clusterCloseoutPreviewValue = asNullableNumber(readNested(event.snapshot, ["clusterCloseoutPreviewValue"])) ?? row.clusterCloseoutPreviewValue;
      row.reopenLocalProbePreviewValue = asNullableNumber(readNested(event.snapshot, ["reopenLocalProbePreviewValue"])) ?? row.reopenLocalProbePreviewValue;
      row.confidenceCollapseReprobePreviewValue = asNullableNumber(readNested(event.snapshot, ["confidenceCollapseReprobePreviewValue"])) ?? row.confidenceCollapseReprobePreviewValue;
      row.reopenLocalProbeDelta = asNullableNumber(readNested(event.snapshot, ["reopenLocalProbeDelta"])) ?? row.reopenLocalProbeDelta;
      row.confidenceCollapseReprobeDelta = asNullableNumber(readNested(event.snapshot, ["confidenceCollapseReprobeDelta"])) ?? row.confidenceCollapseReprobeDelta;
      row.bestRevisionKind = asString(readNested(event.snapshot, ["bestRevisionKind"])) ?? row.bestRevisionKind;
      row.bestRevisionDelta = asNullableNumber(readNested(event.snapshot, ["bestRevisionDelta"])) ?? row.bestRevisionDelta;
      row.positiveRevisionPreview = asBoolean(readNested(event.snapshot, ["positiveRevisionPreview"])) ?? row.positiveRevisionPreview;
      row.coarseBudget = asNullableNumber(readNested(event.snapshot, ["coarseBudget"])) ?? row.coarseBudget;
      row.localBudget = asNullableNumber(readNested(event.snapshot, ["localBudget"])) ?? row.localBudget;
      row.lateBudget = asNullableNumber(readNested(event.snapshot, ["lateBudget"])) ?? row.lateBudget;
      row.salvageStartTurn = asNullableNumber(readNested(event.snapshot, ["salvageStartTurn"])) ?? row.salvageStartTurn;
      row.exploitThreshold = asNullableNumber(readNested(event.snapshot, ["exploitThreshold"])) ?? row.exploitThreshold;
      row.questionFamilyMode = asString(readNested(event.snapshot, ["questionFamilyMode"])) ?? row.questionFamilyMode;
      row.questionBudgetOpen = asBoolean(readNested(event.snapshot, ["questionBudgetOpen"])) ?? row.questionBudgetOpen;
      row.preferQuestion = asBoolean(readNested(event.snapshot, ["preferQuestion"])) ?? row.preferQuestion;
      row.preferExploitShot = asBoolean(readNested(event.snapshot, ["preferExploitShot"])) ?? row.preferExploitShot;
      row.nextRevisionKind = asString(readNested(event.snapshot, ["nextRevisionKind"])) ?? row.nextRevisionKind;
      row.revisionRequested = asBoolean(readNested(event.snapshot, ["revisionRequested"])) ?? row.revisionRequested;
    }

    if (event.type === "reflective_prediction" && isRecord(event.data)) {
      row.predictedActionKind = asString(event.data.actionKind) ?? null;
      row.predictedActionTarget = asString(event.data.actionTarget) ?? null;
      row.predictedHitProb = asNullableNumber(event.data.predictedHitProb) ?? null;
      row.predictedAnswerProb = asNullableNumber(event.data.predictedAnswerProb) ?? null;
      row.predictedQuestionValue = asNullableNumber(event.data.predictedQuestionValue) ?? null;
      row.predictedGain = asNullableNumber(event.data.predictedGain) ?? null;
    }

    if (event.type === "reflective_observation" && isRecord(event.data)) {
      row.observedSignal = asNullableNumber(event.data.observedSignal) ?? null;
      row.realizedGain = asNullableNumber(event.data.realizedGain) ?? null;
      row.observation = asString(event.data.action) ?? "observed";
    }

    if (event.type === "reflective_revision" && isRecord(event.data)) {
      row.revisionReason = asString(event.data.reason) ?? null;
      row.appliedRevisionSource = asString(event.data.source) ?? null;
      row.llmRevisionUsed = asBoolean(event.data.usedLLM) ?? null;
      row.llmRevisionFallback = asBoolean(event.data.llmFallback) ?? null;
      row.bestRevisionKind = asString(event.data.bestRevisionKind) ?? row.bestRevisionKind;
      row.bestRevisionDelta = asNullableNumber(event.data.bestRevisionDelta) ?? row.bestRevisionDelta;
      row.policyMode = asString(event.data.policyMode) ?? row.policyMode;
      row.lastRevisionDelta = asNullableNumber(event.data.lastRevisionDelta) ?? row.lastRevisionDelta;
      row.coarseBudget = asNullableNumber(event.data.coarseBudget) ?? row.coarseBudget;
      row.localBudget = asNullableNumber(event.data.localBudget) ?? row.localBudget;
      row.lateBudget = asNullableNumber(event.data.lateBudget) ?? row.lateBudget;
      row.salvageStartTurn = asNullableNumber(event.data.salvageStartTurn) ?? row.salvageStartTurn;
      row.exploitThreshold = asNullableNumber(event.data.exploitThreshold) ?? row.exploitThreshold;
    }

    turns.set(event.turn, row);
  }

  return [...turns.values()].sort((a, b) => asNumber(a.turn) - asNumber(b.turn));
}

function summarizeTurnCounters(turns: TurnLens[]): Record<string, number> {
  return {
    llmTurns: turns.filter((turn) => turn.gate?.usedLLM === true || turn.llm !== undefined).length,
    autoTurns: turns.filter((turn) => turn.gate?.usedLLM === false).length,
    fallbackTurns: turns.filter((turn) => turn.final?.source === "fallback").length,
    questionTurns: turns.filter((turn) => turn.final?.action === "question").length,
    shotTurns: turns.filter((turn) => turn.final?.action === "shoot").length,
  };
}

function summarizeLLMByGame(events: EventRow[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, { llmTurns: number; latencies: number[]; fallbackTurns: number }>();

  for (const event of events) {
    const row = grouped.get(event.gameId) ?? { llmTurns: 0, latencies: [], fallbackTurns: 0 };

    if (event.type === "gate_decision" && isRecord(event.data) && event.data.usedLLM === true) {
      row.llmTurns += 1;
    }
    if (event.type === "reflective_llm_revision_requested") {
      row.llmTurns += 1;
    }

    if (event.type === "llm_effect_resolved" && isRecord(event.data)) {
      const latency = asNumber(event.data.latencyMs);
      if (latency !== undefined) row.latencies.push(latency);
    }

    if (event.type === "fallback") {
      row.fallbackTurns += 1;
    }

    grouped.set(event.gameId, row);
  }

  return [...grouped.entries()]
    .map(([gameId, row]) => ({
      gameId,
      llmTurns: row.llmTurns,
      avgLatencyMs: row.latencies.length > 0 ? round(mean(row.latencies)) : null,
      fallbackTurns: row.fallbackTurns,
    }))
    .filter((row) => asNumber(row.llmTurns) > 0);
}

function renderTurnRow(turn: TurnLens): Record<string, unknown> {
  return {
    turn: turn.turn,
    progress: turn.snapshot ? asNumber(readNested(turn.snapshot, ["progress"])) : null,
    targetingF1: turn.snapshot ? asNumber(readNested(turn.snapshot, ["targetingF1"])) : null,
    questionEdge: turn.snapshot ? asNumber(readNested(turn.snapshot, ["questionEdge"])) : null,
    noiseAwareQuestionEdge: turn.snapshot ? asNumber(readNested(turn.snapshot, ["noiseAwareQuestionEdge"])) : null,
    effectiveQuestionValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["effectiveQuestionValue"])) : null,
    llmBudgetRemaining: turn.snapshot ? asNumber(readNested(turn.snapshot, ["llmBudgetRemaining"])) : null,
    bestHitProb: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestHitProb"])) : null,
    top2HitGap: turn.snapshot ? asNumber(readNested(turn.snapshot, ["top2HitGap"])) : null,
    posteriorEntropy: turn.snapshot ? asNumber(readNested(turn.snapshot, ["posteriorEntropy"])) : null,
    recentQuestionROI: turn.snapshot ? asNumber(readNested(turn.snapshot, ["recentQuestionROI"])) : null,
    bestMacroPlanKind: turn.snapshot ? asString(readNested(turn.snapshot, ["bestMacroPlanKind"])) : null,
    bestMacroPlanValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestMacroPlanValue"])) : null,
    macroPlanGap: turn.snapshot ? asNumber(readNested(turn.snapshot, ["macroPlanGap"])) : null,
    macroExplorePreferred: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["macroExplorePreferred"])) : null,
    macroExploitPreferred: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["macroExploitPreferred"])) : null,
    coarseQuestionsUsed: turn.snapshot ? asNumber(readNested(turn.snapshot, ["coarseQuestionsUsed"])) : null,
    localQuestionsUsed: turn.snapshot ? asNumber(readNested(turn.snapshot, ["localQuestionsUsed"])) : null,
    lateQuestionsUsed: turn.snapshot ? asNumber(readNested(turn.snapshot, ["lateQuestionsUsed"])) : null,
    worldFrontierCount: turn.snapshot ? asNumber(readNested(turn.snapshot, ["worldFrontierCount"])) : null,
    largestHitClusterSize: turn.snapshot ? asNumber(readNested(turn.snapshot, ["largestHitClusterSize"])) : null,
    hasAnyHitCluster: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["hasAnyHitCluster"])) : null,
    lateSalvagePhase: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["lateSalvagePhase"])) : null,
    llmEnabled: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmEnabled"])) : null,
    llmHitProbThreshold: turn.snapshot ? asNumber(readNested(turn.snapshot, ["llmHitProbThreshold"])) : null,
    llmSalvageQuestionAvailable: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmSalvageQuestionAvailable"])) : null,
    llmSalvageHitProbLow: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmSalvageHitProbLow"])) : null,
    llmSalvageEligible: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmSalvageEligible"])) : null,
    llmGateOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmGateOpen"])) : null,
    bestSalvageQuestionId: turn.snapshot ? asString(readNested(turn.snapshot, ["bestSalvageQuestionId"])) : null,
    bestSalvageQuestionValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestSalvageQuestionValue"])) : null,
    bestSalvageQuestionScore: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestSalvageQuestionScore"])) : null,
    bestSalvageSplitQuality: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestSalvageSplitQuality"])) : null,
    bestSalvageRegionMass: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestSalvageRegionMass"])) : null,
    bestSalvageClusterRelevance: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestSalvageClusterRelevance"])) : null,
    bestShootCellId: turn.snapshot ? asString(readNested(turn.snapshot, ["bestShootCellId"])) : null,
    bestShootCellIndex: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestShootCellIndex"])) : null,
    bestShootBoardValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestShootBoardValue"])) : null,
    bestQuestionAnswerProb: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestQuestionAnswerProb"])) : null,
    bestQuestionBucket: turn.snapshot ? asString(readNested(turn.snapshot, ["bestQuestionBucket"])) : null,
    predictedActionKind: turn.snapshot ? asString(readNested(turn.snapshot, ["predictedActionKind"])) : null,
    predictedActionTarget: turn.snapshot ? asString(readNested(turn.snapshot, ["predictedActionTarget"])) : null,
    predictedGain: turn.snapshot ? asNumber(readNested(turn.snapshot, ["predictedGain"])) : null,
    predictionErrorEMA: turn.snapshot ? asNumber(readNested(turn.snapshot, ["predictionErrorEMA"])) : null,
    calibrationErrorEMA: turn.snapshot ? asNumber(readNested(turn.snapshot, ["calibrationErrorEMA"])) : null,
    lowConfidenceStreak: turn.snapshot ? asNumber(readNested(turn.snapshot, ["lowConfidenceStreak"])) : null,
    recentHighProbMissStreak: turn.snapshot ? asNumber(readNested(turn.snapshot, ["recentHighProbMissStreak"])) : null,
    recentQuestionFailureStreak: turn.snapshot ? asNumber(readNested(turn.snapshot, ["recentQuestionFailureStreak"])) : null,
    exploitLockStreak: turn.snapshot ? asNumber(readNested(turn.snapshot, ["exploitLockStreak"])) : null,
    modelConfidence: turn.snapshot ? asNumber(readNested(turn.snapshot, ["modelConfidence"])) : null,
    needRevision: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["needRevision"])) : null,
    sustainedLowConfidence: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["sustainedLowConfidence"])) : null,
    allowLooseCoarseRevision: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["allowLooseCoarseRevision"])) : null,
    policyMode: turn.snapshot ? asString(readNested(turn.snapshot, ["policyMode"])) : null,
    lastRevisionReason: turn.snapshot ? asString(readNested(turn.snapshot, ["lastRevisionReason"])) : null,
    lastRevisionDelta: turn.snapshot ? asNumber(readNested(turn.snapshot, ["lastRevisionDelta"])) : null,
    currentPolicyPreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["currentPolicyPreviewValue"])) : null,
    coarseCollapsePreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["coarseCollapsePreviewValue"])) : null,
    lateDiffusePreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["lateDiffusePreviewValue"])) : null,
    clusterCloseoutPreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["clusterCloseoutPreviewValue"])) : null,
    reopenLocalProbePreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["reopenLocalProbePreviewValue"])) : null,
    confidenceCollapseReprobePreviewValue: turn.snapshot ? asNumber(readNested(turn.snapshot, ["confidenceCollapseReprobePreviewValue"])) : null,
    reopenLocalProbeDelta: turn.snapshot ? asNumber(readNested(turn.snapshot, ["reopenLocalProbeDelta"])) : null,
    confidenceCollapseReprobeDelta: turn.snapshot ? asNumber(readNested(turn.snapshot, ["confidenceCollapseReprobeDelta"])) : null,
    bestRevisionKind: turn.snapshot ? asString(readNested(turn.snapshot, ["bestRevisionKind"])) : null,
    bestRevisionDelta: turn.snapshot ? asNumber(readNested(turn.snapshot, ["bestRevisionDelta"])) : null,
    positiveRevisionPreview: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["positiveRevisionPreview"])) : null,
    coarseBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["coarseBudget"])) : null,
    localBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["localBudget"])) : null,
    lateBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["lateBudget"])) : null,
    salvageStartTurn: turn.snapshot ? asNumber(readNested(turn.snapshot, ["salvageStartTurn"])) : null,
    exploitThreshold: turn.snapshot ? asNumber(readNested(turn.snapshot, ["exploitThreshold"])) : null,
    questionFamilyMode: turn.snapshot ? asString(readNested(turn.snapshot, ["questionFamilyMode"])) : null,
    questionBudgetOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["questionBudgetOpen"])) : null,
    coarseBudgetOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["coarseBudgetOpen"])) : null,
    localBudgetOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["localBudgetOpen"])) : null,
    lateBudgetOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["lateBudgetOpen"])) : null,
    frontierExploitForced: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["frontierExploitForced"])) : null,
    questionCandidateAvailable: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["questionCandidateAvailable"])) : null,
    questionOutvaluesShot: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["questionOutvaluesShot"])) : null,
    preferQuestion: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["preferQuestion"])) : null,
    preferExploitShot: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["preferExploitShot"])) : null,
    revisionEnabled: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["revisionEnabled"])) : null,
    llmRevisionEnabled: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmRevisionEnabled"])) : null,
    llmRevisionBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["llmRevisionBudget"])) : null,
    llmRevisionCount: turn.snapshot ? asNumber(readNested(turn.snapshot, ["llmRevisionCount"])) : null,
    llmRevisionBudgetOpen: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmRevisionBudgetOpen"])) : null,
    llmRevisionAvailable: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["llmRevisionAvailable"])) : null,
    coarseRoiCollapsed: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["coarseRoiCollapsed"])) : null,
    lateDiffuseReprobeEligible: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["lateDiffuseReprobeEligible"])) : null,
    clusterCloseoutBiasEligible: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["clusterCloseoutBiasEligible"])) : null,
    nextRevisionKind: turn.snapshot ? asString(readNested(turn.snapshot, ["nextRevisionKind"])) : null,
    nextPolicyMode: turn.snapshot ? asString(readNested(turn.snapshot, ["nextPolicyMode"])) : null,
    nextCoarseBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["nextCoarseBudget"])) : null,
    nextLocalBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["nextLocalBudget"])) : null,
    nextLateBudget: turn.snapshot ? asNumber(readNested(turn.snapshot, ["nextLateBudget"])) : null,
    nextSalvageStartTurn: turn.snapshot ? asNumber(readNested(turn.snapshot, ["nextSalvageStartTurn"])) : null,
    nextExploitThreshold: turn.snapshot ? asNumber(readNested(turn.snapshot, ["nextExploitThreshold"])) : null,
    revisionRequested: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["revisionRequested"])) : null,
    lastRevisionSource: turn.snapshot ? asString(readNested(turn.snapshot, ["lastRevisionSource"])) : null,
    lastLLMRevisionFallback: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["lastLLMRevisionFallback"])) : null,
    firstHitFound: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["firstHitFound"])) : null,
    preHitQuestionCapReached: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["preHitQuestionCapReached"])) : null,
    underQuestionTarget: turn.snapshot ? asBoolean(readNested(turn.snapshot, ["underQuestionTarget"])) : null,
    gateUsedLLM: turn.gate?.usedLLM ?? null,
    gateReason: turn.gate?.reason ?? null,
    bestShootCell: turn.gate?.bestShootCell ?? null,
    bestQuestionId: turn.gate?.bestQuestionId ?? null,
    llmStatus: turn.llm?.status ?? null,
    llmLatencyMs: turn.llm?.latencyMs ?? null,
    llmDecisionAction: turn.llm?.decisionAction ?? null,
    llmDecisionCellId: turn.llm?.decisionCellId ?? null,
    llmDecisionQuestionId: turn.llm?.decisionQuestionId ?? null,
    llmDecisionRevisionKind: turn.llm?.decisionRevisionKind ?? null,
    llmDecisionQuestionSource: turn.llm?.decisionQuestionSource ?? null,
    llmDecisionQuestionSpec: turn.llm?.decisionQuestionSpec ?? null,
    llmDecisionReason: turn.llm?.decisionReason ?? null,
    llmModel: turn.llm?.model ?? null,
    llmExplanationStatus: turn.llm?.explanationStatus ?? null,
    llmExplanationLatencyMs: turn.llm?.explanationLatencyMs ?? null,
    llmExplanation: turn.llm?.explanation ?? null,
    pipelineStages: turn.pipelineStages ?? [],
    pipelineFallbacks: turn.pipelineFallbacks ?? [],
    finalSource: turn.final?.source ?? null,
    finalAction: turn.final?.action ?? null,
    finalCellId: turn.final?.cellId ?? null,
    finalQuestionId: turn.final?.questionId ?? null,
    finalQuestionSource: turn.final?.questionSource ?? null,
    finalQuestionSpec: turn.final?.questionSpec ?? null,
    resultKind: turn.result?.kind ?? null,
    resultCellId: turn.result?.cellId ?? null,
    resultIsHit: turn.result?.isHit ?? null,
    resultQuestionId: turn.result?.questionId ?? null,
    resultQuestionSource: turn.result?.questionSource ?? null,
    resultQuestionSpec: turn.result?.questionSpec ?? null,
    resultAnswer: turn.result?.answer ?? null,
  };
}

function resolveGame(
  run: LoadedRun,
  gameId: string | undefined,
  boardId: string | undefined,
  seedIndexRaw: string | undefined,
): GameRow {
  if (gameId) {
    const game = findGame(run.games, gameId);
    if (!game) throw new Error(`Game not found: ${gameId}`);
    return game;
  }

  if (!boardId) {
    throw new Error("--game or --board is required for --view game");
  }

  const seedIndex = seedIndexRaw === undefined ? undefined : parsePositiveInt(seedIndexRaw, 0);
  const candidates = run.games.filter((game) => {
    if (game.boardId !== boardId) return false;
    if (seedIndex !== undefined && game.seedIndex !== seedIndex) return false;
    return true;
  });

  if (candidates.length === 0) {
    throw new Error(`No game found for board ${boardId}`);
  }
  if (candidates.length > 1) {
    throw new Error(`Multiple games found for board ${boardId}; pass --seed-index`);
  }

  return candidates[0];
}

function findGame(games: GameRow[], gameId: string): GameRow | undefined {
  return games.find((game) => game.gameId === gameId);
}

function inferGameFromEvents(events: EventRow[]): GameRow {
  const first = events[0];
  return {
    runId: first.runId,
    gameId: first.gameId,
    boardId: first.boardId,
    seed: first.seed,
    seedIndex: first.seedIndex,
  };
}

function requireEvents(run: LoadedRun): EventRow[] {
  if (!run.events) {
    throw new Error("Events not loaded for this run");
  }
  return run.events;
}

function resolveRunDir(runRef: string): string {
  if (runRef === "latest") {
    const entries = readdirSync(RESULTS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const latest = entries.at(-1);
    if (!latest) throw new Error(`No runs found under ${RESULTS_ROOT}`);
    return resolve(RESULTS_ROOT, latest);
  }

  const direct = resolve(runRef);
  if (existsSync(direct)) return direct;

  const nested = resolve(RESULTS_ROOT, runRef);
  if (existsSync(nested)) return nested;

  throw new Error(`Run not found: ${runRef}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function maybeReadJson<T>(path: string): T | undefined {
  return existsSync(path) ? readJson<T>(path) : undefined;
}

function maybeReadJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split(/\n+/).map((line) => JSON.parse(line) as T);
}

function emit(format: OutputFormat, value: object | string): void {
  if (format === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(renderText(value));
}

function renderText(value: object | string): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function parseView(value: string | undefined): ViewKind {
  switch (value) {
    case "run":
    case "game":
    case "llm":
    case "compare":
    case "macro":
    case "confidence":
    case "question-families":
      return value;
    default:
      throw new Error(`Unsupported view: ${value}`);
  }
}

function parseFormat(value: string | undefined): OutputFormat {
  switch (value) {
    case "text":
    case "json":
      return value;
    default:
      throw new Error(`Unsupported format: ${value}`);
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected non-negative integer, got: ${raw}`);
  }
  return value;
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return round(sorted[index]);
}

function gameKey(game: GameRow): string {
  return `${game.boardId}::${game.seedIndex ?? game.seed}`;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function asNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
