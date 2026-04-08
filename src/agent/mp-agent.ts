/**
 * MP Agent v2: Manifesto Planning Agent on MEL v3.
 *
 * Every cell has its own shoot/think action with `available when` guards.
 * Impossible to re-shoot or think about revealed cells.
 * LLM sees only valid actions via getAvailableActions().
 *
 * Flow: startTurn → [thinkXX, recordSimResult] × N → commitAction → shootXX → recordHit/Miss
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSimulationSession } from "@manifesto-ai/sdk/extensions";
import type { Board } from "../domain/types.js";
import { cellIdToIndex, indexToCellId, BOARD_SIZE, TOTAL_CELLS } from "../domain/types.js";
import { GameState } from "../domain/game-state.js";
import type { BeliefState } from "./belief-state.js";
import { oracleSpotter } from "./spotter.js";
import { SeededRandom } from "../board/generator.js";
import { OllamaClient } from "./legacy-llm/ollama.js";
import { resolveQuestionDescriptor } from "./questions/template-questions.js";

export interface MPAgentConfig {
  particleCount: number;
  epsilon: number;
  ollamaModel: string;
  maxLLMRetries: number;
}

export const DEFAULT_MP_CONFIG: MPAgentConfig = {
  particleCount: 1000,
  epsilon: 0,
  ollamaModel: "gemma3:4b-it-qat",
  maxLLMRetries: 2,
};

interface SimResult {
  cell: string;
  hitProb: number;
  boardValue: number;
}

export interface MPTurnResult {
  action: "shoot" | "question";
  cellId?: string;
  questionId?: string;
  questionText?: string;
  questionAnswer?: boolean;
  thinkingSteps: SimResult[];
  llmCalls: number;
}

/** Map ask action name to an evaluate function for particle reweight */
function buildEvaluateForAsk(actionName: string): (board: Board) => boolean {
  // askRowA → row 0, askRowB → row 1, ...
  const rowMatch = actionName.match(/^askRow([A-H])$/);
  if (rowMatch) {
    const rowIdx = rowMatch[1].charCodeAt(0) - "A".charCodeAt(0);
    return (board) => board.cells.some((c) => c.row === rowIdx && c.hasShip);
  }
  // askCol1 → col 0, askCol2 → col 1, ...
  const colMatch = actionName.match(/^askCol(\d)$/);
  if (colMatch) {
    const colIdx = parseInt(colMatch[1], 10) - 1;
    return (board) => board.cells.some((c) => c.col === colIdx && c.hasShip);
  }
  // Fallback
  return () => false;
}

/** Find cell with highest P(hit) from particles */
function findBestCellByPHit(particles: BeliefState, gameState: GameState): string {
  const revealed = gameState.getRevealedCellIndices();
  let bestCell = 0;
  let bestProb = -1;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (revealed.has(i)) continue;
    let pHit = 0;
    for (const p of particles.particles) {
      if (p.board.cells[i].hasShip) pHit += p.weight;
    }
    if (pHit > bestProb) { bestProb = pHit; bestCell = i; }
  }
  return indexToCellId(bestCell);
}

/** Compute simulation for a cell using sim.next() */
function computeSim(runtime: any, cellName: string, particles: BeliefState): SimResult {
  const cellIndex = cellIdToIndex(cellName);
  let pHit = 0;
  for (const p of particles.particles) {
    if (p.board.cells[cellIndex].hasShip) pHit += p.weight;
  }

  const sim = createSimulationSession(runtime);

  try {
    const afterShoot = sim.next(runtime.MEL.actions.shoot, cellName);
    const hitSnap = afterShoot.next(runtime.MEL.actions.recordHit, cellName).snapshot;
    const missSnap = afterShoot.next(runtime.MEL.actions.recordMiss, cellName).snapshot;
    const hitVal = (hitSnap.computed as any).boardValue as number;
    const missVal = (missSnap.computed as any).boardValue as number;
    return { cell: cellName, hitProb: pHit, boardValue: pHit * hitVal + (1 - pHit) * missVal };
  } catch {
    return { cell: cellName, hitProb: pHit, boardValue: pHit * 0.071 };
  }
}

let melSourceCache: string | null = null;
function getMelSource(): string {
  if (!melSourceCache) {
    melSourceCache = readFileSync(resolve(import.meta.dirname, "../domain/battleship.mel"), "utf-8");
  }
  return melSourceCache;
}

/** System prompt: MEL source + causal graph. Set once per game. */
function buildSystemPrompt(runtime: any): string {
  const mel = getMelSource();
  const graph = runtime.getSchemaGraph();
  const edges = graph.edges
    .map((e: any) => `${e.from} -[${e.relation}]-> ${e.to}`)
    .join("\n");

  return `You are an agent running on this MEL domain. This is your source code:

${mel}

Causal graph:
${edges}

You choose actions each turn. Reply with ONLY the action name, nothing else.
Examples: think D5, shoot D6, askQuestion "Is there a ship in row D?"`;
}

/** User prompt: board + snapshot + available actions. Changes each sub-turn. */
function buildUserPrompt(runtime: any, gameState: GameState, turnHistory: SimResult[]): string {
  const snap = runtime.getSnapshot();
  const d = snap.data as any;
  const c = snap.computed as any;
  const allAvailable = runtime.getAvailableActions() as string[];
  // Only show LLM-relevant actions
  const available = allAvailable.filter((a: string) =>
    a === "think" || a === "shoot" || a === "askQuestion"
  );

  const board = gameState.toAscii();

  const computedStr = Object.entries(c)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? (v as number).toFixed(3) : v}`)
    .join(", ");

  let simStr = "";
  if (turnHistory.length > 0) {
    simStr = "\nSimulations: " + turnHistory.map(
      s => `think ${s.cell} → hitProb=${s.hitProb.toFixed(2)}`
    ).join(", ");
  }

  return `${board}

snapshot.data: shotsFired=${d.shotsFired}, hitCount=${d.hitCount}, missCount=${d.missCount}, shotsRemaining=${d.shotsRemaining}, questionsRemaining=${d.questionsRemaining}, simBudget=${d.simBudget}, simCount=${d.simCount}, bestSimCell=${d.bestSimCell}, bestSimHitProb=${d.bestSimHitProb}
snapshot.computed: ${computedStr}
${simStr}

available: ${available.join(", ")}`;
}

/** Parse LLM response into a dispatchable action + args */
function parseAction(response: string, available: string[]): { action: string; args?: string } | null {
  const trimmed = response.trim().split("\n")[0].trim(); // first line only

  // "think D5" → action=think, args=D5
  const thinkMatch = trimmed.match(/think\s+([A-Ha-h]\d)/i);
  if (thinkMatch && available.includes("think")) {
    return { action: "think", args: thinkMatch[1].toUpperCase() };
  }

  // "shoot D6" → action=shoot, args=D6
  const shootMatch = trimmed.match(/shoot\s+([A-Ha-h]\d)/i);
  if (shootMatch && available.includes("shoot")) {
    return { action: "shoot", args: shootMatch[1].toUpperCase() };
  }

  // "askQuestion ..." → action=askQuestion, args=the text
  const askMatch = trimmed.match(/askQuestion\s+"?([^"]+)"?/i);
  if (askMatch && available.includes("askQuestion")) {
    return { action: "askQuestion", args: askMatch[1] };
  }

  // Direct action name match (e.g. "startTurn", "commitAction")
  for (const action of available) {
    if (trimmed.toLowerCase().includes(action.toLowerCase())) {
      return { action };
    }
  }

  return null;
}

/**
 * MP Agent turn.
 */
/** Conversation history persists across turns within a game */
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function mpAgentTurn(
  runtime: any,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  config: MPAgentConfig,
  rng: SeededRandom,
  askedQuestions: Set<string>,
  ollama: OllamaClient,
  chatHistory?: ChatMessage[],
): Promise<MPTurnResult & { chatHistory: ChatMessage[] }> {
  // 1. Start turn
  try {
    await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.startTurn));
  } catch { /* already started */ }

  const turnHistory: SimResult[] = [];
  let llmCalls = 0;

  // Initialize chat history on first turn
  if (!chatHistory || chatHistory.length === 0) {
    chatHistory = [{ role: "system", content: buildSystemPrompt(runtime) }];
  }

  // 2. Inner thinking loop
  for (let iter = 0; iter < 25; iter++) {
    const allAvail = runtime.getAvailableActions() as string[];
    const llmActions = allAvail.filter((a: string) =>
      a === "think" || a === "shoot" || a === "askQuestion"
    );

    // Add current state as user message
    const userMsg = buildUserPrompt(runtime, gameState, turnHistory);
    chatHistory.push({ role: "user", content: userMsg });

    // Ask LLM with full conversation
    let actionName: { action: string; args?: string } | null = null;
    let rawResponse = "";
    for (let retry = 0; retry < config.maxLLMRetries; retry++) {
      try {
        rawResponse = await ollama.chat(chatHistory, false);
        llmCalls++;
        actionName = parseAction(rawResponse, llmActions);
        if (actionName) {
          // Record LLM response in history
          chatHistory.push({ role: "assistant", content: rawResponse.trim() });
          console.log(`  [MP] LLM → ${actionName.action}${actionName.args ? " " + actionName.args : ""}`);
          break;
        }
      } catch { /* retry */ }
    }

    // LLM failed → remove dangling user message, force shoot
    if (!actionName) {
      chatHistory.pop(); // remove unanswered user msg
      const result = await forceShoot(runtime, gameState, trueBoard, particles, turnHistory, llmCalls);
      chatHistory.push({ role: "user", content: `[auto] shoot ${result.cellId} → ${result.cellId ? "done" : "fail"}` });
      return { ...result, chatHistory };
    }

    const { action, args } = actionName;

    // --- Think ---
    if (action === "think" && args) {
      if (turnHistory.some(s => s.cell === args)) {
        chatHistory.push({ role: "user", content: `Already thought about ${args}. Pick a different cell.` });
        continue;
      }
      await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.think, args));
      const simResult = computeSim(runtime, args, particles);
      await runtime.commitAsync(
        runtime.createIntent(runtime.MEL.actions.recordSimResult, args, simResult.hitProb, simResult.boardValue),
      );
      turnHistory.push(simResult);
      const msg = `think ${args} → hitProb=${simResult.hitProb.toFixed(2)}, boardValue=${simResult.boardValue.toFixed(3)}`;
      chatHistory.push({ role: "user", content: msg });
      console.log(`  [MP] ${msg}`);
      continue;
    }

    // --- Shoot ---
    if (action === "shoot" && args) {
      const revealed = gameState.getRevealedCellIndices();
      const idx = cellIdToIndex(args);
      if (idx >= 0 && idx < TOTAL_CELLS && !revealed.has(idx)) {
        await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.commitAction));
        const result = await executeShot(runtime, gameState, trueBoard, particles, args, turnHistory, llmCalls);
        const isHit = result.cellId && gameState.getCell(result.cellId)?.status === "hit";
        chatHistory.push({ role: "user", content: `shoot ${args} → ${isHit ? "HIT!" : "MISS"}` });
        return { ...result, chatHistory };
      }
      chatHistory.push({ role: "user", content: `${args} already revealed. Pick another cell.` });
      continue;
    }

    // --- Ask question ---
    if (action === "askQuestion" && args) {
      const question = resolveQuestionDescriptor(args, buildEvaluateForAsk(args));
      await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.commitAction));
      await runtime.commitAsync(
        runtime.createIntent(runtime.MEL.actions.askQuestion, question.id, question.text),
      );
      const answer = question.evaluate(trueBoard);
      particles.observeAnswer(question.evaluate, answer, config.epsilon);
      const msg = `ask "${question.text}" → ${answer ? "YES" : "NO"}`;
      chatHistory.push({ role: "user", content: msg });
      console.log(`  [MP] ${msg}`);
      return {
        ...{
          action: "question" as const,
          questionId: question.id,
          questionText: question.text,
          questionAnswer: answer,
          thinkingSteps: turnHistory,
          llmCalls,
        },
        chatHistory,
      };
    }
  }

  // Loop exhausted
  const result = await forceShoot(runtime, gameState, trueBoard, particles, turnHistory, llmCalls);
  chatHistory!.push({ role: "user", content: `[auto] shoot ${result.cellId}` });
  return { ...result, chatHistory: chatHistory! };
}

async function forceShoot(
  runtime: any,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  turnHistory: SimResult[],
  llmCalls: number,
): Promise<MPTurnResult> {
  // If not confident yet, force-think until we are
  const snap = runtime.getSnapshot();
  const c = snap.computed as any;
  if (!c.confident) {
    // Auto-think the best cells by P(hit) until confident
    const revealed = gameState.getRevealedCellIndices();
    const cellsByPHit: { index: number; pHit: number }[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (revealed.has(i)) continue;
      let pHit = 0;
      for (const p of particles.particles) {
        if (p.board.cells[i].hasShip) pHit += p.weight;
      }
      cellsByPHit.push({ index: i, pHit });
    }
    cellsByPHit.sort((a, b) => b.pHit - a.pHit);

    for (const cell of cellsByPHit.slice(0, 5)) {
      const cellId = indexToCellId(cell.index);
      try {
        await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.think, cellId));
        const sim = computeSim(runtime, cellId, particles);
        await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.recordSimResult, cellId, sim.hitProb, sim.boardValue));
        turnHistory.push(sim);
        console.log(`  [MP] auto-think${cellId} → hitProb=${sim.hitProb.toFixed(2)}`);

        // Check if now confident
        const s2 = runtime.getSnapshot();
        if ((s2.computed as any).confident) break;
      } catch { break; }
    }
  }

  await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.commitAction));

  // Now find best shoot from available actions
  const available = runtime.getAvailableActions() as string[];
  const shoots = available.filter((a: string) => a.startsWith("shoot"));

  const d2 = runtime.getSnapshot().data as any;
  const bestCell = d2.bestSimCell || findBestCellByPHit(particles, gameState);

  return executeShot(runtime, gameState, trueBoard, particles, bestCell, turnHistory, llmCalls);

  return { action: "shoot", cellId: "??", thinkingSteps: turnHistory, llmCalls };
}

async function executeShot(
  runtime: any,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  cellName: string,
  turnHistory: SimResult[],
  llmCalls: number,
): Promise<MPTurnResult> {
  await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.shoot, cellName));

  const cell = gameState.getCell(cellName);
  const isHit = cell?.hasShip ?? false;
  if (cell) cell.status = isHit ? "hit" : "miss";

  console.log(`  [MP] SHOOT ${cellName} → ${isHit ? "HIT" : "MISS"}`);

  if (isHit) {
    await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.recordHit, cellName));
    if (cell?.shipId) {
      const ship = gameState.ships.get(cell.shipId);
      if (ship) { ship.hitCount++; if (ship.hitCount >= ship.size) ship.sunk = true; }
    }
  } else {
    await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, cellName));
  }

  if (gameState.allShipsSunk()) {
    await runtime.commitAsync(runtime.createIntent(runtime.MEL.actions.endGame, "won"));
  }

  const cellIndex = cellIdToIndex(cellName);
  particles.observeShot(cellIndex, isHit);

  return { action: "shoot", cellId: cellName, thinkingSteps: turnHistory, llmCalls };
}
