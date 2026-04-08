import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeSnapshot, type JsonValue } from "../../experiment/logging.js";
import type { LLMClient } from "../../llm/client.js";
import { withFallbackLogging, withStageLatency, withStageLogging } from "../../pipeline/decorators.js";
import type { ExperimentPipelineStage, PipelineRuntimeContext } from "../../pipeline/experiment-pipeline.js";
import type { WorldBeliefSummary } from "../../runtime/world-belief-summary.js";
import type { TurnContext, TurnDecision, Strategy } from "../strategy.js";
import { WMAStrategy } from "./strategy.js";
import { createSalvageCompileStage } from "./salvage/compile-stage.js";
import { createSalvageCandidateStage } from "./salvage/candidate-stage.js";
import { createSalvageDecisionLLMStage, explainDecisionChoice } from "./salvage/llm-stage.js";
import {
  buildExplanationPrompt,
  createDecisionPromptStage,
  createDecisionSystemPrompt,
  createExplanationSystemPrompt,
} from "./salvage/prompts.js";
import { createSalvageSummaryStage } from "./salvage/summary-stage.js";
import type {
  DecisionResolution,
  LLMExplanationChoice,
  SalvageCandidateBundle,
  SalvageCompileInput,
  SalvageDecisionPromptInput,
  SalvageLLMDecisionResult,
  SalvagePromptPayload,
  SalvageSummaryState,
} from "./salvage/types.js";

const PIPELINE_SOURCE = "strategy:wma-llm";
const WEAK_BOARD_IDS = new Set(["B06", "B09", "B11", "B14", "B17"]);

export class WMALLMSalvageStrategy implements Strategy {
  readonly name = "wma-llm-salvage";
  readonly policyName = "weak-board-llm-salvage";

  private readonly decisionLLM: LLMClient;
  private readonly explanationLLM?: LLMClient;
  private readonly fallbackStrategy: WMAStrategy;
  private readonly decisionSystemPrompt: string;
  private readonly explanationSystemPrompt?: string;
  private readonly coarseQuestionBudget: number;
  private readonly lateQuestionBudget: number;
  private readonly lateGameTurn = 16;

  private readonly summaryStage: ExperimentPipelineStage<TurnContext, SalvageSummaryState>;
  private readonly candidateStage: ExperimentPipelineStage<SalvageSummaryState, SalvageCandidateBundle>;
  private readonly promptStage: ExperimentPipelineStage<SalvageCandidateBundle, SalvagePromptPayload>;
  private readonly decisionStage: ExperimentPipelineStage<SalvageDecisionPromptInput, SalvageLLMDecisionResult>;
  private readonly compileStage: ExperimentPipelineStage<SalvageCompileInput, DecisionResolution | null>;

  constructor(
    decisionLLM: LLMClient,
    explanationLLM: LLMClient | undefined,
    candidateQuestions: number = 10,
    targetQuestions: number = 12,
    private readonly llmCandidates: number = 3,
  ) {
    this.decisionLLM = decisionLLM;
    this.explanationLLM = explanationLLM;
    this.fallbackStrategy = new WMAStrategy(candidateQuestions, targetQuestions);
    this.coarseQuestionBudget = Math.max(0, Math.min(6, targetQuestions));
    this.lateQuestionBudget = Math.max(0, targetQuestions - this.coarseQuestionBudget);
    this.decisionSystemPrompt = createDecisionSystemPrompt();

    if (this.explanationLLM) {
      const mel = readFileSync(resolve(import.meta.dirname, "../../domain/battleship-world.mel"), "utf-8");
      this.explanationSystemPrompt = createExplanationSystemPrompt(mel);
    }

    this.summaryStage = decorateStage(createSalvageSummaryStage(this.lateGameTurn));
    this.candidateStage = decorateStage(createSalvageCandidateStage({
      coarseQuestionBudget: this.coarseQuestionBudget,
      lateQuestionBudget: this.lateQuestionBudget,
      llmCandidates: this.llmCandidates,
    }));
    this.promptStage = decorateStage(createDecisionPromptStage(this.decisionSystemPrompt));
    this.decisionStage = decorateStage(createSalvageDecisionLLMStage(this.decisionLLM, this.decisionLLM.name));
    this.compileStage = decorateFallbackStage(createSalvageCompileStage());
  }

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    if (!WEAK_BOARD_IDS.has(ctx.boardId)) {
      return this.fallbackStrategy.decideTurn(ctx);
    }

    const runtime = this.createRuntime(ctx);
    const summary = (await this.summaryStage.run(ctx, runtime)).value;
    const bundle = (await this.candidateStage.run(summary, runtime)).value;

    await recordWorldSummary(ctx, bundle.summary, bundle.hasKnownHits && bundle.bestQuestionCandidate
      ? {
          id: bundle.bestQuestionCandidate.question.id,
          rawValue: bundle.bestQuestionCandidate.detail.value,
          score: bundle.bestQuestionCandidate.adjustedValue,
          splitQuality: bundle.bestQuestionCandidate.splitQuality,
          regionMass: bundle.bestQuestionCandidate.regionMass,
          clusterRelevance: bundle.bestQuestionCandidate.clusterRelevance ?? 0,
        }
      : null);

    const frontierDecision = this.selectFrontierExploit(bundle);
    if (frontierDecision) {
      this.logGateDecision(ctx, bundle, false, "frontier_exploit", frontierDecision.cellId ?? null);
      return this.finalizeDecision(ctx, frontierDecision, runtime.turn, "auto");
    }

    const shouldUseLLM = this.shouldUseLLM(ctx);
    this.logGateDecision(
      ctx,
      bundle,
      shouldUseLLM,
      shouldUseLLM ? "weak_board_salvage_llm" : bundle.defaultReason,
      bundle.bestShoot.cellId,
    );

    if (!shouldUseLLM) {
      return this.finalizeDecision(ctx, bundle.defaultDecision, runtime.turn, "auto");
    }

    const prompt = (await this.promptStage.run(bundle, runtime)).value;
    const llmResult = (await this.decisionStage.run({ bundle, prompt }, runtime)).value;
    const compileResult = await this.compileStage.run({ bundle, llmResult }, runtime);
    const resolved = compileResult.value;

    if (resolved) {
      const explanation = await this.maybeExplain(ctx, bundle, resolved.decision, runtime);
      return this.finalizeDecision(ctx, resolved.decision, runtime.turn, "llm", explanation);
    }

    const fallbackReason = readFallbackReason(compileResult.metadata, llmResult.errorMessage);
    this.logFallback(ctx, runtime.turn, fallbackReason, bundle.defaultDecision);
    return this.finalizeDecision(ctx, bundle.defaultDecision, runtime.turn, "fallback");
  }

  private createRuntime(ctx: TurnContext): PipelineRuntimeContext {
    return {
      turn: Number(ctx.bridge.data.turnNumber ?? 0),
      source: PIPELINE_SOURCE,
      logger: ctx.logger,
      getSnapshot: () => summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
    };
  }

  private shouldUseLLM(ctx: TurnContext): boolean {
    return WEAK_BOARD_IDS.has(ctx.boardId) &&
      ctx.bridge.computed.llmGateOpen === true;
  }

  private selectFrontierExploit(bundle: SalvageCandidateBundle): TurnDecision | null {
    const bestFrontier = bundle.shootResults.find((candidate) => bundle.frontierCellIds.has(candidate.cellId));
    if (!bestFrontier) {
      return null;
    }
    return {
      action: "shoot",
      cellId: bestFrontier.cellId,
      cellIndex: bestFrontier.cellIndex,
    };
  }

  private logGateDecision(
    ctx: TurnContext,
    bundle: SalvageCandidateBundle,
    usedLLM: boolean,
    reason: string,
    bestShootCellOverride?: string | null,
  ): void {
    ctx.logger?.log({
      turn: Number(ctx.bridge.data.turnNumber ?? 0),
      source: PIPELINE_SOURCE,
      type: "gate_decision",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        usedLLM,
        reason,
        bestShoot: {
          cell: bestShootCellOverride ?? bundle.bestShoot.cellId,
          hitProb: bundle.bestShoot.hitProb,
          boardValue: bundle.bestShoot.boardValue,
        },
        bestQuestion: bundle.bestQuestion
          ? {
              id: bundle.bestQuestion.id,
              family: bundle.bestQuestion.family,
              text: bundle.bestQuestion.text,
              value: bundle.bestQuestionValue,
            }
          : null,
      },
    });
  }

  private logFallback(
    ctx: TurnContext,
    turn: number,
    reason: string,
    fallbackDecision: TurnDecision,
  ): void {
    ctx.logger?.log({
      turn,
      source: PIPELINE_SOURCE,
      type: "fallback",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        reason,
        fallbackCell: fallbackDecision.cellId ?? null,
        fallbackQuestionId: fallbackDecision.questionId ?? null,
      },
    });
  }

  private async maybeExplain(
    ctx: TurnContext,
    bundle: SalvageCandidateBundle,
    decision: TurnDecision,
    runtime: PipelineRuntimeContext,
  ): Promise<LLMExplanationChoice> {
    if (!this.explanationLLM || !this.explanationSystemPrompt) {
      return {};
    }
    return explainDecisionChoice(
      this.explanationLLM,
      this.explanationLLM.name,
      this.explanationSystemPrompt,
      buildExplanationPrompt(ctx, bundle, decision),
      runtime.turn,
      runtime,
    );
  }

  private finalizeDecision(
    ctx: TurnContext,
    decision: TurnDecision,
    turn: number,
    source: "auto" | "llm" | "fallback",
    explanation: LLMExplanationChoice = {},
  ): TurnDecision {
    if (decision.action === "question" && decision.questionId) {
      ctx.askedQuestions.add(decision.questionId);
    }

    ctx.logger?.log({
      turn,
      source: PIPELINE_SOURCE,
      type: "final_decision",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        source,
        action: decision.action,
        cellId: decision.cellId ?? null,
        questionId: decision.questionId ?? null,
        questionSource: decision.questionSource ?? null,
        questionSpec: decision.questionSpec ?? null,
        reason: explanation.reason ?? null,
        explanation: explanation.explanation ?? null,
      },
    });
    return decision;
  }
}

function decorateStage<I, O>(
  stage: ExperimentPipelineStage<I, O>,
): ExperimentPipelineStage<I, O> {
  return withStageLogging(withStageLatency(stage));
}

function decorateFallbackStage<I, O>(
  stage: ExperimentPipelineStage<I, O>,
): ExperimentPipelineStage<I, O> {
  return withFallbackLogging(withStageLogging(withStageLatency(stage)));
}

async function recordWorldSummary(
  ctx: TurnContext,
  summary: WorldBeliefSummary,
  salvage: {
    id: string;
    rawValue: number;
    score: number;
    splitQuality: number;
    regionMass: number;
    clusterRelevance: number;
  } | null,
): Promise<void> {
  await ctx.bridge.dispatch(
    "recordWorldSummary",
    summary.frontierCount,
    summary.largestHitClusterSize,
    summary.bestHitProb,
    salvage?.id ?? "",
    salvage?.rawValue ?? 0,
    salvage?.score ?? 0,
    salvage?.splitQuality ?? 0,
    salvage?.regionMass ?? 0,
    salvage?.clusterRelevance ?? 0,
  );
}

function readFallbackReason(metadata: JsonValue | undefined, defaultReason: string | null): string {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const reason = metadata.fallbackReason;
    if (typeof reason === "string" && reason.length > 0) {
      return reason;
    }
  }
  return defaultReason ?? "llm_response_invalid_for_candidate_set";
}
