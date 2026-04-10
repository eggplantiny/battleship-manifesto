import {
  createBattleshipReflectiveRuntime,
  createBattleshipLineageRuntime,
  createBattleshipRuntime,
  createBattleshipWorldRuntime,
} from "../../src/domain/wire.js";
import { ManifestoBridge } from "../../src/runtime/bridge.js";
import { loadBoard, getAllBoardIds } from "../../src/board/boards.js";
import { playGame, type GameResult } from "../../src/runtime/runner.js";
import { createStrategy, type StrategyName } from "../../src/strategies/create-strategy.js";
import type { BeliefKind } from "../../src/belief/belief-state.js";
import type { LLMProvider } from "../../src/llm/client.js";
import { createFileExperimentLogger, createRunId } from "./file-experiment-logger.js";

export type ProtocolName = "paper" | "oracle" | "custom";

export interface StrategyExperimentOptions {
  strategyName: StrategyName;
  boards?: string;
  seeds?: number;
  particles?: number;
  belief?: BeliefKind;
  model: string;
  decisionModel?: string;
  explainModel?: string;
  llmProvider?: LLMProvider;
  llmBaseUrl?: string;
  decisionProvider?: LLMProvider;
  decisionBaseUrl?: string;
  explainProvider?: LLMProvider;
  explainBaseUrl?: string;
  label?: string;
  logDir?: string;
  epsilon?: number;
  gamma?: number;
  candidateQuestions?: number;
  llmCandidates?: number;
  targetQuestions?: number;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
  confidenceThreshold?: number;
  revisionCooldown?: number;
  minRevisionDelta?: number;
  revisionEnabled?: boolean;
  llmRevisionEnabled?: boolean;
  llmRevisionBudget?: number;
  policyDoubtThreshold?: number;
  protocol?: ProtocolName;
  onGameComplete?: (args: {
    boardId: string;
    seedIndex: number;
    result: GameResult;
  }) => void;
}

export interface ResolvedStrategyExperimentOptions {
  strategyName: StrategyName;
  boardIds: string[];
  seedCount: number;
  particleCount: number;
  beliefKind: BeliefKind;
  model: string;
  decisionModel?: string;
  explainModel?: string;
  llmProvider?: LLMProvider;
  llmBaseUrl?: string;
  decisionProvider?: LLMProvider;
  decisionBaseUrl?: string;
  explainProvider?: LLMProvider;
  explainBaseUrl?: string;
  label?: string;
  logDir: string;
  epsilon: number;
  gamma: number;
  candidateQuestions: number;
  llmCandidates: number;
  targetQuestions?: number;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
  confidenceThreshold?: number;
  revisionCooldown?: number;
  minRevisionDelta?: number;
  revisionEnabled?: boolean;
  llmRevisionEnabled?: boolean;
  llmRevisionBudget?: number;
  policyDoubtThreshold?: number;
  protocolName: ProtocolName;
}

export interface StrategyExperimentResult {
  options: ResolvedStrategyExperimentOptions;
  results: GameResult[];
  outputDir: string;
  runId: string;
}

const PROTOCOL_DEFAULTS: Record<ProtocolName, Omit<ResolvedStrategyExperimentOptions, "strategyName" | "boardIds" | "model" | "label" | "logDir">> = {
  paper: {
    seedCount: 3,
    particleCount: 500,
    beliefKind: "smc",
    epsilon: 0.1,
    gamma: 0.95,
    candidateQuestions: 10,
    llmCandidates: 5,
    protocolName: "paper",
  },
  oracle: {
    seedCount: 3,
    particleCount: 500,
    beliefKind: "smc",
    epsilon: 0,
    gamma: 0.95,
    candidateQuestions: 10,
    llmCandidates: 5,
    protocolName: "oracle",
  },
  custom: {
    seedCount: 1,
    particleCount: 500,
    beliefKind: "smc",
    epsilon: 0.1,
    gamma: 0.95,
    candidateQuestions: 10,
    llmCandidates: 5,
    protocolName: "custom",
  },
};

export function resolveStrategyExperimentOptions(
  options: StrategyExperimentOptions,
): ResolvedStrategyExperimentOptions {
  const protocolName = options.protocol ?? "paper";
  const defaults = PROTOCOL_DEFAULTS[protocolName];

  return {
    strategyName: options.strategyName,
    boardIds: (options.boards ?? "all") === "all" ? getAllBoardIds() : (options.boards ?? "all").split(","),
    seedCount: options.seeds ?? defaults.seedCount,
    particleCount: options.particles ?? defaults.particleCount,
    beliefKind: options.belief ?? defaults.beliefKind,
    model: options.model,
    decisionModel: options.decisionModel,
    explainModel: options.explainModel,
    llmProvider: options.llmProvider,
    llmBaseUrl: options.llmBaseUrl,
    decisionProvider: options.decisionProvider,
    decisionBaseUrl: options.decisionBaseUrl,
    explainProvider: options.explainProvider,
    explainBaseUrl: options.explainBaseUrl,
    label: options.label,
    logDir: options.logDir ?? "results/runs",
    epsilon: options.epsilon ?? defaults.epsilon,
    gamma: options.gamma ?? defaults.gamma,
    candidateQuestions: options.candidateQuestions ?? defaults.candidateQuestions,
    llmCandidates: options.llmCandidates ?? defaults.llmCandidates,
    targetQuestions: options.targetQuestions,
    coarseBudget: options.coarseBudget,
    localBudget: options.localBudget,
    lateBudget: options.lateBudget,
    confidenceThreshold: options.confidenceThreshold,
    revisionCooldown: options.revisionCooldown,
    minRevisionDelta: options.minRevisionDelta,
    revisionEnabled: options.revisionEnabled,
    llmRevisionEnabled: options.llmRevisionEnabled,
    llmRevisionBudget: options.llmRevisionBudget,
    policyDoubtThreshold: options.policyDoubtThreshold,
    protocolName,
  };
}

function hashSeed(boardId: string, seed: number): number {
  let hash = seed * 31;
  for (let index = 0; index < boardId.length; index++) {
    hash = (hash * 31 + boardId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) + 1;
}

function strategyNeedsLineage(strategyName: StrategyName): boolean {
  return strategyName === "mp" || strategyName.startsWith("mmp");
}

function strategyUsesWorldRuntime(strategyName: StrategyName): boolean {
  return strategyName === "wma" || strategyName === "wma-llm-salvage";
}

function strategyUsesReflectiveRuntime(strategyName: StrategyName): boolean {
  return strategyName === "mra" || strategyName === "cra" || strategyName === "rma" || strategyName === "mra-llm";
}

export async function runStrategyExperiment(
  options: StrategyExperimentOptions,
): Promise<StrategyExperimentResult> {
  const resolved = resolveStrategyExperimentOptions(options);
  const strategy = createStrategy(resolved.strategyName, {
    model: resolved.model,
    decisionModel: resolved.decisionModel,
    explainModel: resolved.explainModel,
    llmProvider: resolved.llmProvider,
    llmBaseUrl: resolved.llmBaseUrl,
    decisionProvider: resolved.decisionProvider,
    decisionBaseUrl: resolved.decisionBaseUrl,
    explainProvider: resolved.explainProvider,
    explainBaseUrl: resolved.explainBaseUrl,
    candidateQuestions: resolved.candidateQuestions,
    llmCandidates: resolved.llmCandidates,
    gamma: resolved.gamma,
    targetQuestions: resolved.targetQuestions,
    coarseBudget: resolved.coarseBudget,
    localBudget: resolved.localBudget,
    lateBudget: resolved.lateBudget,
    confidenceThreshold: resolved.confidenceThreshold,
    revisionCooldown: resolved.revisionCooldown,
    minRevisionDelta: resolved.minRevisionDelta,
    revisionEnabled: resolved.revisionEnabled,
    llmRevisionEnabled: resolved.llmRevisionEnabled,
    llmRevisionBudget: resolved.llmRevisionBudget,
    policyDoubtThreshold: resolved.policyDoubtThreshold,
  });
  const logger = createFileExperimentLogger(
    {
      runId: createRunId(`${resolved.strategyName}-${resolved.beliefKind}`, resolved.label),
      strategyName: resolved.strategyName,
      policyName: strategy.policyName,
      protocolName: resolved.protocolName,
      beliefKind: resolved.beliefKind,
      boardIds: resolved.boardIds,
      seedCount: resolved.seedCount,
      particleCount: resolved.particleCount,
      epsilon: resolved.epsilon,
      model: resolved.model,
      label: resolved.label,
      startedAt: new Date().toISOString(),
      command: process.argv.join(" "),
    },
    resolved.logDir,
  );

  const results: GameResult[] = [];
  let gameIndex = 0;
  let runStatus: "completed" | "failed" = "completed";
  let errorMessage: string | undefined;

  try {
    for (const boardId of resolved.boardIds) {
        const trueBoard = loadBoard(boardId);
      for (let seed = 0; seed < resolved.seedCount; seed++) {
        const gameSeed = hashSeed(boardId, seed);
        const runtimeBundle = strategyNeedsLineage(resolved.strategyName)
          ? createBattleshipLineageRuntime(trueBoard, {
              provider: resolved.llmProvider,
              model: resolved.model,
              baseUrl: resolved.llmBaseUrl,
            })
          : strategyUsesReflectiveRuntime(resolved.strategyName)
            ? createBattleshipReflectiveRuntime(trueBoard)
          : strategyUsesWorldRuntime(resolved.strategyName)
            ? createBattleshipWorldRuntime(trueBoard)
            : createBattleshipRuntime(trueBoard);
        const { runtime, gameState } = runtimeBundle;
        const bridge = new ManifestoBridge(runtime, strategyNeedsLineage(resolved.strategyName));
        const gameLogger = logger.startGame({
          gameId: `${boardId}-seed${seed}`,
          gameIndex,
          strategyName: resolved.strategyName,
          policyName: strategy.policyName,
          beliefKind: resolved.beliefKind,
          boardId,
          seed: gameSeed,
          seedIndex: seed,
          particleCount: resolved.particleCount,
          epsilon: resolved.epsilon,
        });

        const result = await playGame(
          bridge,
          gameState,
          trueBoard,
          strategy,
          {
            beliefKind: resolved.beliefKind,
            particleCount: resolved.particleCount,
            epsilon: resolved.epsilon,
            worldMode: "worldMode" in runtimeBundle ? runtimeBundle.worldMode : false,
            logger: gameLogger,
            effectTelemetry: "effectTelemetry" in runtimeBundle
              ? runtimeBundle.effectTelemetry
              : undefined,
          },
          boardId,
          gameSeed,
        );
        results.push(result);
        options.onGameComplete?.({ boardId, seedIndex: seed, result });
        gameIndex += 1;
      }
    }
  } catch (error) {
    runStatus = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const avgF1 = results.length > 0
      ? results.reduce((sum, result) => sum + result.targetingF1, 0) / results.length
      : 0;
    const wins = results.filter((result) => result.won).length;
    const avgShots = results.length > 0
      ? results.reduce((sum, result) => sum + result.shotsFired, 0) / results.length
      : 0;
    const avgQuestions = results.length > 0
      ? results.reduce((sum, result) => sum + result.questionsAsked, 0) / results.length
      : 0;
    const avgHits = results.length > 0
      ? results.reduce((sum, result) => sum + result.hitCount, 0) / results.length
      : 0;
    const avgMisses = results.length > 0
      ? results.reduce((sum, result) => sum + result.missCount, 0) / results.length
      : 0;

    logger.close({
      finishedAt: new Date().toISOString(),
      games: results.length,
      avgF1,
      avgShots,
      avgQuestions,
      avgHits,
      avgMisses,
      wins,
      winRate: results.length > 0 ? wins / results.length : 0,
      status: runStatus,
      errorMessage,
    });
  }

  return {
    options: resolved,
    results,
    outputDir: logger.outputDir,
    runId: logger.runId,
  };
}
