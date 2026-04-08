export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SnapshotSummary {
  phase?: string;
  turnNumber?: number;
  shotsFired?: number;
  questionsAsked?: number;
  hitCount?: number;
  missCount?: number;
  shotsRemaining?: number;
  questionsRemaining?: number;
  unknownCount?: number;
  progress?: number;
  targetingF1?: number;
  boardValue?: number;
  simBudget?: number;
  simCount?: number;
  bestSimCell?: string;
  bestQuestionId?: string;
  bestSimHitProb?: number;
  bestSimBoardValue?: number;
  confident?: boolean;
  thinkingPhase?: string;
  llmStatus?: string;
  llmDecisionAction?: string;
  llmDecisionQuestionId?: string;
  llmDecisionCellId?: string;
  llmLatencyMs?: number;
  bestQuestionValue?: number;
  questionEdge?: number;
  noisePenalty?: number;
  effectiveQuestionValue?: number;
  noiseAwareQuestionEdge?: number;
  earlyGame?: boolean;
  questionBudgetRich?: boolean;
  shouldExplore?: boolean;
  firstHitFound?: boolean;
  preHitQuestionCapReached?: boolean;
  underQuestionTarget?: boolean;
  lateGame?: boolean;
  questionBudgetTight?: boolean;
  tinyQuestionEdge?: boolean;
  llmBudgetRemaining?: number;
  llmBudgetAvailable?: boolean;
  autoQuestionPreferred?: boolean;
  autoShootPreferred?: boolean;
  llmAdjudicationNeeded?: boolean;
  bestHitProb?: number;
  secondHitProb?: number;
  top2HitGap?: number;
  posteriorEntropy?: number;
  frontierCellCount?: number;
  remainingFitLength2?: number;
  remainingFitLength3?: number;
  remainingFitLength4?: number;
  remainingFitLength5?: number;
  totalRemainingFitCount?: number;
  recentQuestionROI?: number;
  bestProbePlanValue?: number;
  bestExploitPlanValue?: number;
  bestCloseoutPlanValue?: number;
  bestMacroPlanKind?: string;
  bestMacroPlanValue?: number;
  macroPlanGap?: number;
  highConfidenceFrontier?: boolean;
  diffusePosterior?: boolean;
  collapsedPosterior?: boolean;
  shipFitTight?: boolean;
  questionROIPositive?: boolean;
  macroProbeDominates?: boolean;
  macroExploitDominates?: boolean;
  macroExplorePreferred?: boolean;
  macroExploitPreferred?: boolean;
  coarseQuestionsUsed?: number;
  localQuestionsUsed?: number;
  lateQuestionsUsed?: number;
  worldFrontierCount?: number;
  largestHitClusterSize?: number;
  hasAnyHitCluster?: boolean;
  lateSalvagePhase?: boolean;
  llmEnabled?: boolean;
  llmHitProbThreshold?: number;
  llmSalvageQuestionAvailable?: boolean;
  llmSalvageHitProbLow?: boolean;
  llmSalvageEligible?: boolean;
  llmGateOpen?: boolean;
  bestSalvageQuestionId?: string;
  bestSalvageQuestionValue?: number;
  bestSalvageQuestionScore?: number;
  bestSalvageSplitQuality?: number;
  bestSalvageRegionMass?: number;
  bestSalvageClusterRelevance?: number;
  bestShootCellId?: string;
  bestShootCellIndex?: number;
  bestShootBoardValue?: number;
  bestQuestionAnswerProb?: number;
  bestQuestionBucket?: string;
  predictedActionKind?: string;
  predictedActionTarget?: string;
  predictedHitProb?: number;
  predictedAnswerProb?: number;
  predictedQuestionValue?: number;
  predictedGain?: number;
  predictionBaselineValue?: number;
  observedTurnCount?: number;
  predictionErrorEMA?: number;
  calibrationErrorEMA?: number;
  lowConfidenceStreak?: number;
  recentHighProbMissStreak?: number;
  recentQuestionFailureStreak?: number;
  exploitLockStreak?: number;
  modelConfidence?: number;
  needRevision?: boolean;
  canRevisePolicy?: boolean;
  shouldRevisePolicy?: boolean;
  confidenceThreshold?: number;
  minRevisionDelta?: number;
  allowLooseCoarseRevision?: boolean;
  revisionCooldownTurns?: number;
  revisionCooldownRemaining?: number;
  revisionEnabled?: boolean;
  llmRevisionEnabled?: boolean;
  llmRevisionBudget?: number;
  llmRevisionCount?: number;
  llmRevisionBudgetOpen?: boolean;
  llmRevisionAvailable?: boolean;
  revisionCount?: number;
  policyMode?: string;
  lastRevisionReason?: string;
  lastRevisionSource?: string;
  lastRevisionDelta?: number;
  lastLLMRevisionFallback?: boolean;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
  salvageStartTurn?: number;
  exploitThreshold?: number;
  questionFamilyMode?: string;
  questionBudgetOpen?: boolean;
  coarseBudgetOpen?: boolean;
  localBudgetOpen?: boolean;
  lateBudgetOpen?: boolean;
  frontierExploitForced?: boolean;
  questionCandidateAvailable?: boolean;
  questionOutvaluesShot?: boolean;
  preferQuestion?: boolean;
  preferExploitShot?: boolean;
  coarseRoiCollapsed?: boolean;
  lateDiffuseReprobeEligible?: boolean;
  clusterCloseoutBiasEligible?: boolean;
  currentPolicyPreviewValue?: number;
  coarseCollapsePreviewValue?: number;
  lateDiffusePreviewValue?: number;
  clusterCloseoutPreviewValue?: number;
  reopenLocalProbePreviewValue?: number;
  confidenceCollapseReprobePreviewValue?: number;
  sustainedLowConfidence?: boolean;
  coarseCollapseDelta?: number;
  lateDiffuseDelta?: number;
  clusterCloseoutDelta?: number;
  reopenLocalProbeDelta?: number;
  confidenceCollapseReprobeDelta?: number;
  bestRevisionKind?: string;
  bestRevisionDelta?: number;
  positiveRevisionPreview?: boolean;
  nextRevisionKind?: string;
  nextPolicyMode?: string;
  nextCoarseBudget?: number;
  nextLocalBudget?: number;
  nextLateBudget?: number;
  nextSalvageStartTurn?: number;
  nextExploitThreshold?: number;
  revisionRequested?: boolean;
}

export interface GameLogMeta {
  runId: string;
  gameId: string;
  gameIndex: number;
  strategyName: string;
  policyName?: string;
  beliefKind?: string;
  boardId: string;
  seed: number;
  seedIndex: number;
  particleCount: number;
  epsilon: number;
}

export interface GameLogEvent {
  turn: number;
  source: string;
  type: string;
  snapshot?: SnapshotSummary;
  data?: JsonValue;
}

export interface GameLogSummary {
  boardId: string;
  seed: number;
  strategyName: string;
  policyName?: string;
  shotsFired: number;
  questionsAsked: number;
  hitCount: number;
  missCount: number;
  totalShipCells: number;
  targetingF1: number;
  won: boolean;
}

export interface GameLogger {
  readonly meta: GameLogMeta;
  log(event: GameLogEvent): void;
  close(summary: GameLogSummary): void;
  abort(error: JsonValue): void;
}

export interface ExperimentRunMeta {
  runId: string;
  strategyName: string;
  policyName?: string;
  protocolName?: string;
  beliefKind?: string;
  boardIds: string[];
  seedCount: number;
  particleCount: number;
  epsilon: number;
  model?: string;
  label?: string;
  startedAt: string;
  command: string;
}

export interface ExperimentRunSummary {
  finishedAt: string;
  games: number;
  avgF1: number;
  avgShots?: number;
  avgQuestions?: number;
  avgHits?: number;
  avgMisses?: number;
  wins: number;
  winRate: number;
  runtimeSeconds?: number;
  status?: "completed" | "failed";
  errorMessage?: string;
  llmTurns?: number;
  autoDecidedTurns?: number;
  fallbackTurns?: number;
  outputDir: string;
}

export interface ExperimentLogger {
  readonly runId: string;
  readonly outputDir: string;
  startGame(meta: Omit<GameLogMeta, "runId">): GameLogger;
  close(summary: Omit<ExperimentRunSummary, "outputDir">): void;
}

export interface TurnDecisionSummary {
  action: "shoot" | "question";
  cellId?: string;
  cellIndex?: number;
  questionId?: string;
  questionText?: string;
  questionSource?: "template" | "synthesized";
  questionSpec?: unknown;
}

export function summarizeSnapshot(
  data: Record<string, unknown>,
  computed: Record<string, unknown>,
): SnapshotSummary {
  return {
    phase: readString(data.phase),
    turnNumber: readNumber(data.turnNumber),
    shotsFired: readNumber(data.shotsFired),
    questionsAsked: readNumber(data.questionsAsked),
    hitCount: readNumber(data.hitCount),
    missCount: readNumber(data.missCount),
    shotsRemaining: readNumber(data.shotsRemaining),
    questionsRemaining: readNumber(data.questionsRemaining),
    unknownCount: readNumber(computed.unknownCount),
    progress: readNumber(computed.progress),
    targetingF1: readNumber(computed.targetingF1),
    boardValue: readNumber(computed.boardValue),
    simBudget: readNumber(data.simBudget),
    simCount: readNumber(data.simCount),
    bestSimCell: readString(data.bestSimCell),
    bestQuestionId: readString(data.bestQuestionId),
    bestSimHitProb: readNumber(data.bestSimHitProb),
    bestSimBoardValue: readNumber(data.bestSimBoardValue),
    confident: readBoolean(computed.confident),
    thinkingPhase: readString(data.thinkingPhase),
    llmStatus: readString(data.llmStatus),
    llmDecisionAction: readString(data.llmDecisionAction),
    llmDecisionQuestionId: readString(data.llmDecisionQuestionId),
    llmDecisionCellId: readString(data.llmDecisionCellId),
    bestQuestionValue: readNumber(data.bestQuestionValue),
    questionEdge: readNumber(computed.questionEdge),
    noisePenalty: readNumber(data.noisePenalty),
    effectiveQuestionValue: readNumber(data.effectiveQuestionValue),
    noiseAwareQuestionEdge: readNumber(computed.noiseAwareQuestionEdge),
    earlyGame: readBoolean(computed.earlyGame),
    questionBudgetRich: readBoolean(computed.questionBudgetRich),
    shouldExplore: readBoolean(computed.shouldExplore),
    firstHitFound: readBoolean(computed.firstHitFound),
    preHitQuestionCapReached: readBoolean(computed.preHitQuestionCapReached),
    underQuestionTarget: readBoolean(computed.underQuestionTarget),
    lateGame: readBoolean(computed.lateGame),
    questionBudgetTight: readBoolean(computed.questionBudgetTight),
    tinyQuestionEdge: readBoolean(computed.tinyQuestionEdge),
    llmBudgetRemaining: readNumber(data.llmBudgetRemaining),
    llmBudgetAvailable: readBoolean(computed.llmBudgetAvailable),
    autoQuestionPreferred: readBoolean(computed.autoQuestionPreferred),
    autoShootPreferred: readBoolean(computed.autoShootPreferred),
    llmAdjudicationNeeded: readBoolean(computed.llmAdjudicationNeeded),
    bestHitProb: readNumber(data.bestHitProb),
    secondHitProb: readNumber(data.secondHitProb),
    top2HitGap: readNumber(data.top2HitGap),
    posteriorEntropy: readNumber(data.posteriorEntropy),
    frontierCellCount: readNumber(data.frontierCellCount),
    remainingFitLength2: readNumber(data.remainingFitLength2),
    remainingFitLength3: readNumber(data.remainingFitLength3),
    remainingFitLength4: readNumber(data.remainingFitLength4),
    remainingFitLength5: readNumber(data.remainingFitLength5),
    totalRemainingFitCount: readNumber(data.totalRemainingFitCount),
    recentQuestionROI: readNumber(data.recentQuestionROI),
    bestProbePlanValue: readNumber(data.bestProbePlanValue),
    bestExploitPlanValue: readNumber(data.bestExploitPlanValue),
    bestCloseoutPlanValue: readNumber(data.bestCloseoutPlanValue),
    bestMacroPlanKind: readString(data.bestMacroPlanKind),
    bestMacroPlanValue: readNumber(data.bestMacroPlanValue),
    macroPlanGap: readNumber(computed.macroPlanGap),
    highConfidenceFrontier: readBoolean(computed.highConfidenceFrontier),
    diffusePosterior: readBoolean(computed.diffusePosterior),
    collapsedPosterior: readBoolean(computed.collapsedPosterior),
    shipFitTight: readBoolean(computed.shipFitTight),
    questionROIPositive: readBoolean(computed.questionROIPositive),
    macroProbeDominates: readBoolean(computed.macroProbeDominates),
    macroExploitDominates: readBoolean(computed.macroExploitDominates),
    macroExplorePreferred: readBoolean(computed.macroExplorePreferred),
    macroExploitPreferred: readBoolean(computed.macroExploitPreferred),
    coarseQuestionsUsed: readNumber(data.coarseQuestionsUsed),
    localQuestionsUsed: readNumber(data.localQuestionsUsed),
    lateQuestionsUsed: readNumber(data.lateQuestionsUsed),
    worldFrontierCount: readNumber(data.frontierCount),
    largestHitClusterSize: readNumber(data.largestHitClusterSize),
    hasAnyHitCluster: readBoolean(computed.hasAnyHitCluster),
    lateSalvagePhase: readBoolean(computed.lateSalvagePhase),
    llmEnabled: readBoolean(data.llmEnabled),
    llmHitProbThreshold: readNumber(data.llmHitProbThreshold),
    llmSalvageQuestionAvailable: readBoolean(computed.llmSalvageQuestionAvailable),
    llmSalvageHitProbLow: readBoolean(computed.llmSalvageHitProbLow),
    llmSalvageEligible: readBoolean(computed.llmSalvageEligible),
    llmGateOpen: readBoolean(computed.llmGateOpen),
    bestSalvageQuestionId: readString(data.bestSalvageQuestionId),
    bestSalvageQuestionValue: readNumber(data.bestSalvageQuestionValue),
    bestSalvageQuestionScore: readNumber(data.bestSalvageQuestionScore),
    bestSalvageSplitQuality: readNumber(data.bestSalvageSplitQuality),
    bestSalvageRegionMass: readNumber(data.bestSalvageRegionMass),
    bestSalvageClusterRelevance: readNumber(data.bestSalvageClusterRelevance),
    bestShootCellId: readString(data.bestShootCellId),
    bestShootCellIndex: readNumber(data.bestShootCellIndex),
    bestShootBoardValue: readNumber(data.bestShootBoardValue),
    bestQuestionAnswerProb: readNumber(data.bestQuestionAnswerProb),
    bestQuestionBucket: readString(data.bestQuestionBucket),
    predictedActionKind: readString(data.predictedActionKind),
    predictedActionTarget: readString(data.predictedActionTarget),
    predictedHitProb: readNumber(data.predictedHitProb),
    predictedAnswerProb: readNumber(data.predictedAnswerProb),
    predictedQuestionValue: readNumber(data.predictedQuestionValue),
    predictedGain: readNumber(data.predictedGain),
    predictionBaselineValue: readNumber(data.predictionBaselineValue),
    observedTurnCount: readNumber(data.observedTurnCount),
    predictionErrorEMA: readNumber(data.predictionErrorEMA),
    calibrationErrorEMA: readNumber(data.calibrationErrorEMA),
    lowConfidenceStreak: readNumber(data.lowConfidenceStreak),
    recentHighProbMissStreak: readNumber(data.recentHighProbMissStreak),
    recentQuestionFailureStreak: readNumber(data.recentQuestionFailureStreak),
    exploitLockStreak: readNumber(data.exploitLockStreak),
    modelConfidence: readNumber(computed.modelConfidence),
    needRevision: readBoolean(computed.needRevision),
    canRevisePolicy: readBoolean(computed.canRevisePolicy),
    shouldRevisePolicy: readBoolean(computed.shouldRevisePolicy),
    confidenceThreshold: readNumber(data.confidenceThreshold),
    minRevisionDelta: readNumber(data.minRevisionDelta),
    allowLooseCoarseRevision: readBoolean(data.allowLooseCoarseRevision),
    revisionCooldownTurns: readNumber(data.revisionCooldownTurns),
    revisionCooldownRemaining: readNumber(data.revisionCooldownRemaining),
    revisionEnabled: readBoolean(data.revisionEnabled),
    llmRevisionEnabled: readBoolean(data.llmRevisionEnabled),
    llmRevisionBudget: readNumber(data.llmRevisionBudget),
    llmRevisionCount: readNumber(data.llmRevisionCount),
    llmRevisionBudgetOpen: readBoolean(computed.llmRevisionBudgetOpen),
    llmRevisionAvailable: readBoolean(computed.llmRevisionAvailable),
    revisionCount: readNumber(data.revisionCount),
    policyMode: readString(data.policyMode),
    lastRevisionReason: readString(data.lastRevisionReason),
    lastRevisionSource: readString(data.lastRevisionSource),
    lastRevisionDelta: readNumber(data.lastRevisionDelta),
    lastLLMRevisionFallback: readBoolean(data.lastLLMRevisionFallback),
    coarseBudget: readNumber(data.coarseBudget),
    localBudget: readNumber(data.localBudget),
    lateBudget: readNumber(data.lateBudget),
    salvageStartTurn: readNumber(data.salvageStartTurn),
    exploitThreshold: readNumber(data.exploitThreshold),
    questionFamilyMode: readString(computed.questionFamilyMode),
    questionBudgetOpen: readBoolean(computed.questionBudgetOpen),
    coarseBudgetOpen: readBoolean(computed.coarseBudgetOpen),
    localBudgetOpen: readBoolean(computed.localBudgetOpen),
    lateBudgetOpen: readBoolean(computed.lateBudgetOpen),
    frontierExploitForced: readBoolean(computed.frontierExploitForced),
    questionCandidateAvailable: readBoolean(computed.questionCandidateAvailable),
    questionOutvaluesShot: readBoolean(computed.questionOutvaluesShot),
    preferQuestion: readBoolean(computed.preferQuestion),
    preferExploitShot: readBoolean(computed.preferExploitShot),
    coarseRoiCollapsed: readBoolean(computed.coarseRoiCollapsed),
    lateDiffuseReprobeEligible: readBoolean(computed.lateDiffuseReprobeEligible),
    clusterCloseoutBiasEligible: readBoolean(computed.clusterCloseoutBiasEligible),
    currentPolicyPreviewValue: readNumber(data.currentPolicyPreviewValue),
    coarseCollapsePreviewValue: readNumber(data.coarseCollapsePreviewValue),
    lateDiffusePreviewValue: readNumber(data.lateDiffusePreviewValue),
    clusterCloseoutPreviewValue: readNumber(data.clusterCloseoutPreviewValue),
    reopenLocalProbePreviewValue: readNumber(data.reopenLocalProbePreviewValue),
    confidenceCollapseReprobePreviewValue: readNumber(data.confidenceCollapseReprobePreviewValue),
    sustainedLowConfidence: readBoolean(computed.sustainedLowConfidence),
    coarseCollapseDelta: readNumber(computed.coarseCollapseDelta),
    lateDiffuseDelta: readNumber(computed.lateDiffuseDelta),
    clusterCloseoutDelta: readNumber(computed.clusterCloseoutDelta),
    reopenLocalProbeDelta: readNumber(computed.reopenLocalProbeDelta),
    confidenceCollapseReprobeDelta: readNumber(computed.confidenceCollapseReprobeDelta),
    bestRevisionKind: readString(computed.bestRevisionKind),
    bestRevisionDelta: readNumber(computed.bestRevisionDelta),
    positiveRevisionPreview: readBoolean(computed.positiveRevisionPreview),
    nextRevisionKind: readString(computed.nextRevisionKind),
    nextPolicyMode: readString(computed.nextPolicyMode),
    nextCoarseBudget: readNumber(computed.nextCoarseBudget),
    nextLocalBudget: readNumber(computed.nextLocalBudget),
    nextLateBudget: readNumber(computed.nextLateBudget),
    nextSalvageStartTurn: readNumber(computed.nextSalvageStartTurn),
    nextExploitThreshold: readNumber(computed.nextExploitThreshold),
    revisionRequested: readBoolean(computed.revisionRequested),
  };
}

export function summarizeDecision(decision: TurnDecisionSummary): JsonValue {
  return {
    action: decision.action,
    cellId: decision.cellId ?? null,
    cellIndex: decision.cellIndex ?? null,
    questionId: decision.questionId ?? null,
    questionText: decision.questionText ?? null,
    questionSource: decision.questionSource ?? null,
    questionSpec: sanitizeJson(decision.questionSpec),
  };
}

function sanitizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJson(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(record)) {
      output[key] = sanitizeJson(entry);
    }
    return output;
  }

  return String(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
