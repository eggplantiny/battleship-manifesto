import { summarizeSnapshot } from "../../../experiment/logging.js";
import { OllamaClient } from "../../llm/ollama.js";
import type { Strategy, TurnContext, TurnDecision, TurnOutcome } from "../strategy.js";
import {
  evaluateAllWorldCells,
  evaluateWorldQuestionDetailed,
} from "../../core/simulation-world.js";
import {
  getTemplateQuestions,
  inferQuestionFamilyFromId,
  isCoarseQuestionFamily,
  isLocalQuestionFamily,
  type QuestionDescriptor,
} from "../../questions/template-questions.js";
import {
  computeWorldBeliefSummary,
  scoreCoarseQuestion,
  scoreSalvageQuestion,
  type SalvageQuestionScore,
  type WorldBeliefSummary,
} from "../../core/world-belief-summary.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.72;
const DEFAULT_REVISION_COOLDOWN = 3;
const DEFAULT_REVISION_ENABLED = true;
const DEFAULT_LLM_REVISION_ENABLED = false;
const DEFAULT_LLM_REVISION_BUDGET = 999;

type QuestionMode = "coarse" | "local" | "late" | "none";
type RevisionKind =
  | "coarse_roi_collapse"
  | "late_diffuse_reprobe"
  | "cluster_closeout_bias";

interface RevisionPlan {
  revisionKind: RevisionKind;
  policyMode: string;
  coarseBudget: number;
  localBudget: number;
  lateBudget: number;
  salvageStartTurn: number;
  exploitThreshold: number;
}

interface AppliedRevisionMeta {
  source: "symbolic" | "llm";
  usedLLM: boolean;
  fallback: boolean;
  model?: string | null;
}

interface PolicyPreviewState {
  coarseBudget: number;
  localBudget: number;
  lateBudget: number;
  salvageStartTurn: number;
  exploitThreshold: number;
}

interface RevisionPreviewValues {
  currentPolicyValue: number;
  coarseCollapsePreviewValue: number;
  lateDiffusePreviewValue: number;
  clusterCloseoutPreviewValue: number;
}

abstract class ReflectiveStrategyBase implements Strategy {
  abstract readonly name: string;
  abstract readonly policyName: string;

  constructor(
    protected readonly candidateQuestions: number = 10,
    protected readonly confidenceThreshold?: number,
    protected readonly revisionCooldown?: number,
    protected readonly revisionEnabled: boolean = DEFAULT_REVISION_ENABLED,
    protected readonly llmRevisionEnabled: boolean = DEFAULT_LLM_REVISION_ENABLED,
    protected readonly llmRevisionBudget: number = DEFAULT_LLM_REVISION_BUDGET,
  ) {}

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    await this.ensureReflectionConfigured(ctx);

    const shootResults = evaluateAllWorldCells(ctx.bridge, ctx.particles);
    if (shootResults.length === 0) {
      throw new Error(`${this.name} found no dispatchable shoot candidates`);
    }

    const bestShoot = shootResults[0];
    const currentBoardValue = asNumber(ctx.bridge.computed.boardValue, 0);
    const summary = computeWorldBeliefSummary(ctx.bridge, ctx.particles, bestShoot.hitProb);

    await recordWorldSummary(ctx, summary, null);

    const questionMode = readQuestionMode(ctx);
    const questionBudgetOpen = ctx.bridge.computed.questionBudgetOpen === true;

    let bestQuestion: QuestionDescriptor | null = null;
    let bestQuestionValue = 0;
    let bestQuestionAnswerProb = 0;
    let bestSalvageScore: SalvageQuestionScore | null = null;

    if (
      asNumber(ctx.bridge.data.questionsRemaining, 0) > 0 &&
      questionBudgetOpen &&
      questionMode !== "none"
    ) {
      const questions = selectQuestionsForMode(questionMode, ctx.askedQuestions)
        .slice(0, this.candidateQuestions);

      for (const question of questions) {
        try {
          const detail = evaluateWorldQuestionDetailed(
            ctx.bridge,
            question,
            ctx.particles,
            ctx.epsilon,
          );
          const score = questionMode === "coarse"
            ? scoreCoarseQuestion(summary, question, detail.value, detail.pYes)
            : scoreSalvageQuestion(summary, question, detail.value, detail.pYes);
          if (score.adjustedValue > bestQuestionValue) {
            bestQuestionValue = score.adjustedValue;
            bestQuestion = question;
            bestQuestionAnswerProb = detail.pYes;
            bestSalvageScore = questionMode === "coarse" ? null : score;
          }
        } catch {
          // Skip broken question/sample combinations.
        }
      }
    }

    await recordWorldSummary(
      ctx,
      summary,
      bestQuestion && questionMode !== "coarse"
        ? { id: bestQuestion.id, score: bestSalvageScore }
        : null,
    );
    await recordDecisionContext(
      ctx,
      bestShoot.cellId,
      bestShoot.cellIndex,
      bestShoot.boardValue,
      bestQuestion?.id ?? "",
      bestQuestionValue,
      bestQuestionAnswerProb,
      bestQuestion ? questionMode : "",
    );
    await recordRevisionPreview(ctx, buildRevisionPreviewValues(
      ctx,
      summary,
      bestShoot,
      this.candidateQuestions,
    ));

    const preferQuestion = ctx.bridge.computed.preferQuestion === true;
    if (preferQuestion && bestQuestion) {
      const predictedGain = Math.max(0, bestQuestionValue - currentBoardValue);
      await this.recordPrediction(
        ctx,
        "question",
        bestQuestion.id,
        bestShoot.hitProb,
        bestQuestionAnswerProb,
        bestQuestionValue,
        predictedGain,
        currentBoardValue,
      );
      this.logPrediction(ctx, {
        actionKind: "question",
        actionTarget: bestQuestion.id,
        predictedHitProb: bestShoot.hitProb,
        predictedAnswerProb: bestQuestionAnswerProb,
        predictedQuestionValue: bestQuestionValue,
        predictedGain,
        baselineBoardValue: currentBoardValue,
      });
      return {
        action: "question",
        questionId: bestQuestion.id,
        questionText: bestQuestion.text,
        questionSource: bestQuestion.source ?? "template",
        questionSpec: "questionSpec" in bestQuestion ? (bestQuestion as { questionSpec?: unknown }).questionSpec : undefined,
        evaluate: bestQuestion.evaluate,
      };
    }

    const predictedGain = Math.max(0, bestShoot.boardValue - currentBoardValue);
    await this.recordPrediction(
      ctx,
      "shoot",
      bestShoot.cellId,
      bestShoot.hitProb,
      0,
      0,
      predictedGain,
      currentBoardValue,
    );
    this.logPrediction(ctx, {
      actionKind: "shoot",
      actionTarget: bestShoot.cellId,
      predictedHitProb: bestShoot.hitProb,
      predictedAnswerProb: 0,
      predictedQuestionValue: 0,
      predictedGain,
      baselineBoardValue: currentBoardValue,
    });
    return {
      action: "shoot",
      cellId: bestShoot.cellId,
      cellIndex: bestShoot.cellIndex,
    };
  }

  async afterTurn(ctx: TurnContext, outcome: TurnOutcome): Promise<void> {
    const observedSignal = outcome.action === "shoot"
      ? (outcome.isHit ? 1 : 0)
      : (outcome.answer ? 1 : 0);
    const realizedGain = outcome.action === "shoot"
      ? Math.max(
          0,
          asNumber(ctx.bridge.computed.boardValue, 0) -
          asNumber(ctx.bridge.data.predictionBaselineValue, 0),
        )
      : Math.max(0, currentBestHitProb(ctx) - asNumber(ctx.bridge.data.predictedHitProb, 0));

    await ctx.bridge.dispatch("recordObservation", observedSignal, realizedGain);
    this.logObservation(ctx, outcome, observedSignal, realizedGain);

    if (ctx.bridge.data.phase !== "playing") {
      return;
    }

    await ctx.bridge.dispatch("updateConfidenceStreak", ctx.bridge.computed.needRevision === true);

    if (ctx.bridge.computed.shouldRevisePolicy !== true) {
      return;
    }

    const applied = await this.applyRevision(ctx);
    if (applied) {
      this.logRevision(ctx, applied);
    }
  }

  protected async applyRevision(ctx: TurnContext): Promise<AppliedRevisionMeta | null> {
    await ctx.bridge.dispatch("applyRevisionPreset", "symbolic", false);
    return {
      source: "symbolic",
      usedLLM: false,
      fallback: false,
      model: null,
    };
  }

  protected get logSource(): string {
    return `strategy:${this.name}`;
  }

  protected async ensureReflectionConfigured(ctx: TurnContext): Promise<void> {
    const desiredThreshold = this.confidenceThreshold;
    const desiredCooldown = this.revisionCooldown;
    const currentThreshold = asNumber(
      ctx.bridge.data.confidenceThreshold,
      DEFAULT_CONFIDENCE_THRESHOLD,
    );
    const currentCooldown = asNumber(
      ctx.bridge.data.revisionCooldownTurns,
      DEFAULT_REVISION_COOLDOWN,
    );
    const nextThreshold = desiredThreshold ?? currentThreshold;
    const nextCooldown = desiredCooldown ?? currentCooldown;

    if (currentThreshold !== nextThreshold || currentCooldown !== nextCooldown) {
      await ctx.bridge.dispatch("configureReflection", nextThreshold, nextCooldown);
    }

    const currentRevisionEnabled = readBoolean(ctx.bridge.data.revisionEnabled, DEFAULT_REVISION_ENABLED);
    const currentLLMRevisionEnabled = readBoolean(
      ctx.bridge.data.llmRevisionEnabled,
      DEFAULT_LLM_REVISION_ENABLED,
    );
    const currentLLMRevisionBudget = asNumber(
      ctx.bridge.data.llmRevisionBudget,
      DEFAULT_LLM_REVISION_BUDGET,
    );

    if (
      currentRevisionEnabled !== this.revisionEnabled ||
      currentLLMRevisionEnabled !== this.llmRevisionEnabled ||
      currentLLMRevisionBudget !== this.llmRevisionBudget
    ) {
      await ctx.bridge.dispatch(
        "configureRevisionControls",
        this.revisionEnabled,
        this.llmRevisionEnabled,
        this.llmRevisionBudget,
      );
    }
  }

  protected async recordPrediction(
    ctx: TurnContext,
    actionKind: string,
    actionTarget: string,
    hitProb: number,
    answerProb: number,
    questionValue: number,
    gain: number,
    baselineValue: number,
  ): Promise<void> {
    await ctx.bridge.dispatch(
      "recordPrediction",
      actionKind,
      actionTarget,
      hitProb,
      answerProb,
      questionValue,
      gain,
      baselineValue,
    );
  }

  protected logPrediction(
    ctx: TurnContext,
    data: {
      actionKind: string;
      actionTarget: string;
      predictedHitProb: number;
      predictedAnswerProb: number;
      predictedQuestionValue: number;
      predictedGain: number;
      baselineBoardValue: number;
    },
  ): void {
    ctx.logger?.log({
      turn: asNumber(ctx.bridge.data.turnNumber, 0),
      source: this.logSource,
      type: "reflective_prediction",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data,
    });
  }

  protected logObservation(
    ctx: TurnContext,
    outcome: TurnOutcome,
    observedSignal: number,
    realizedGain: number,
  ): void {
    ctx.logger?.log({
      turn: asNumber(ctx.bridge.data.turnNumber, 0),
      source: this.logSource,
      type: "reflective_observation",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        action: outcome.action,
        target: outcome.action === "shoot" ? outcome.cellId : outcome.questionId,
        observedSignal,
        realizedGain,
      },
    });
  }

  protected logRevision(ctx: TurnContext, applied: AppliedRevisionMeta): void {
    ctx.logger?.log({
      turn: asNumber(ctx.bridge.data.turnNumber, 0),
      source: this.logSource,
      type: "reflective_revision",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        reason: readString(ctx.bridge.data.lastRevisionReason) ?? null,
        source: applied.source,
        usedLLM: applied.usedLLM,
        llmFallback: applied.fallback,
        model: applied.model ?? null,
        policyMode: readString(ctx.bridge.data.policyMode) ?? null,
        coarseBudget: asNumber(ctx.bridge.data.coarseBudget, 0),
        localBudget: asNumber(ctx.bridge.data.localBudget, 0),
        lateBudget: asNumber(ctx.bridge.data.lateBudget, 0),
        salvageStartTurn: asNumber(ctx.bridge.data.salvageStartTurn, 0),
        exploitThreshold: asNumber(ctx.bridge.data.exploitThreshold, 0),
      },
    });
  }
}

export class MRAStrategy extends ReflectiveStrategyBase {
  readonly name = "mra";
  readonly policyName = "reflective-v2";

  constructor(
    candidateQuestions: number = 10,
    confidenceThreshold?: number,
    revisionCooldown?: number,
    revisionEnabled: boolean = true,
  ) {
    super(
      candidateQuestions,
      confidenceThreshold,
      revisionCooldown,
      revisionEnabled,
      false,
      DEFAULT_LLM_REVISION_BUDGET,
    );
  }
}

export class MRALLMStrategy extends ReflectiveStrategyBase {
  readonly name = "mra-llm";
  readonly policyName = "reflective-llm-v1";

  private readonly ollama: OllamaClient;

  constructor(
    private readonly decisionModel: string,
    candidateQuestions: number = 10,
    confidenceThreshold?: number,
    revisionCooldown?: number,
    revisionEnabled: boolean = true,
    llmRevisionEnabled: boolean = true,
    llmRevisionBudget: number = DEFAULT_LLM_REVISION_BUDGET,
  ) {
    super(
      candidateQuestions,
      confidenceThreshold,
      revisionCooldown,
      revisionEnabled,
      llmRevisionEnabled,
      llmRevisionBudget,
    );
    this.ollama = new OllamaClient(decisionModel);
  }

  protected override async applyRevision(ctx: TurnContext): Promise<AppliedRevisionMeta | null> {
    if (ctx.bridge.computed.llmRevisionAvailable !== true) {
      return super.applyRevision(ctx);
    }

    const turn = asNumber(ctx.bridge.data.turnNumber, 0);
    const preview = readRevisionPreview(ctx);
    const snapshot = summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed);

    ctx.logger?.log({
      turn,
      source: this.logSource,
      type: "reflective_llm_revision_requested",
      snapshot,
      data: {
        model: this.decisionModel,
        modelConfidence: snapshot.modelConfidence ?? null,
        confidenceThreshold: snapshot.confidenceThreshold ?? null,
        nextRevisionKind: preview.revisionKind,
        llmRevisionCount: asNumber(ctx.bridge.data.llmRevisionCount, 0),
        llmRevisionBudget: asNumber(ctx.bridge.data.llmRevisionBudget, DEFAULT_LLM_REVISION_BUDGET),
      },
    });

    const startedAt = Date.now();
    let proposal: RevisionPlan | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await this.ollama.chat([
        { role: "system", content: buildLLMRevisionSystemPrompt() },
        { role: "user", content: buildLLMRevisionUserPrompt(snapshot, preview) },
      ]);
      proposal = parseRevisionProposal(response, preview);
      if (!proposal) {
        errorMessage = "revision_response_invalid";
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const latencyMs = Date.now() - startedAt;
    ctx.logger?.log({
      turn,
      source: this.logSource,
      type: "llm_effect_resolved",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        model: this.decisionModel,
        phase: "reflective_revision",
        status: proposal ? "success" : "error",
        latencyMs,
        decisionAction: "revision",
        decisionRevisionKind: proposal?.revisionKind ?? null,
        errorMessage,
      },
    });

    if (!proposal) {
      ctx.logger?.log({
        turn,
        source: this.logSource,
        type: "fallback",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          reason: errorMessage ?? "revision_response_invalid",
          stage: "reflective_revision",
        },
      });
      await ctx.bridge.dispatch("applyRevisionPreset", "symbolic", true);
      return {
        source: "symbolic",
        usedLLM: true,
        fallback: true,
        model: this.decisionModel,
      };
    }

    try {
      await ctx.bridge.dispatch(
        "applyRevisionPatch",
        proposal.revisionKind,
        proposal.policyMode,
        proposal.coarseBudget,
        proposal.localBudget,
        proposal.lateBudget,
        proposal.salvageStartTurn,
        proposal.exploitThreshold,
        "llm",
        false,
      );
      return {
        source: "llm",
        usedLLM: true,
        fallback: false,
        model: this.decisionModel,
      };
    } catch (error) {
      const dispatchError = error instanceof Error ? error.message : String(error);
      ctx.logger?.log({
        turn,
        source: this.logSource,
        type: "fallback",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          reason: dispatchError,
          stage: "reflective_revision",
        },
      });
      await ctx.bridge.dispatch("applyRevisionPreset", "symbolic", true);
      return {
        source: "symbolic",
        usedLLM: true,
        fallback: true,
        model: this.decisionModel,
      };
    }
  }
}

async function recordWorldSummary(
  ctx: TurnContext,
  summary: WorldBeliefSummary,
  salvage: { id: string; score: SalvageQuestionScore | null } | null,
): Promise<void> {
  await ctx.bridge.dispatch(
    "recordWorldSummary",
    summary.frontierCount,
    summary.largestHitClusterSize,
    summary.bestHitProb,
    salvage?.id ?? "",
    salvage?.score?.rawValue ?? 0,
    salvage?.score?.adjustedValue ?? 0,
    salvage?.score?.splitQuality ?? 0,
    salvage?.score?.regionMass ?? 0,
    salvage?.score?.clusterRelevance ?? 0,
  );
}

async function recordDecisionContext(
  ctx: TurnContext,
  bestShootCellId: string,
  bestShootCellIndex: number,
  bestShootBoardValue: number,
  bestQuestionId: string,
  bestQuestionValue: number,
  bestQuestionAnswerProb: number,
  bestQuestionBucket: string,
): Promise<void> {
  await ctx.bridge.dispatch(
    "recordDecisionContext",
    bestShootCellId,
    bestShootCellIndex,
    bestShootBoardValue,
    bestQuestionId,
    bestQuestionValue,
    bestQuestionAnswerProb,
    bestQuestionBucket,
  );
}

async function recordRevisionPreview(
  ctx: TurnContext,
  preview: RevisionPreviewValues,
): Promise<void> {
  await ctx.bridge.dispatch(
    "recordRevisionPreview",
    preview.currentPolicyValue,
    preview.coarseCollapsePreviewValue,
    preview.lateDiffusePreviewValue,
    preview.clusterCloseoutPreviewValue,
  );
}

function currentBestHitProb(ctx: TurnContext): number {
  const results = evaluateAllWorldCells(ctx.bridge, ctx.particles);
  return results[0]?.hitProb ?? 0;
}

function buildRevisionPreviewValues(
  ctx: TurnContext,
  summary: WorldBeliefSummary,
  bestShoot: { hitProb: number; boardValue: number },
  candidateQuestions: number,
): RevisionPreviewValues {
  const current = readCurrentPolicyState(ctx);
  return {
    currentPolicyValue: evaluatePolicyPreview(ctx, summary, bestShoot, current, candidateQuestions),
    coarseCollapsePreviewValue: evaluatePolicyPreview(
      ctx,
      summary,
      bestShoot,
      {
        ...current,
        coarseBudget: Math.max(0, current.coarseBudget - 1),
        localBudget: current.localBudget + 1,
      },
      candidateQuestions,
    ),
    lateDiffusePreviewValue: evaluatePolicyPreview(
      ctx,
      summary,
      bestShoot,
      {
        ...current,
        localBudget: Math.max(0, current.localBudget - 1),
        lateBudget: current.lateBudget + 1,
        salvageStartTurn: Math.max(12, current.salvageStartTurn - 1),
      },
      candidateQuestions,
    ),
    clusterCloseoutPreviewValue: evaluatePolicyPreview(
      ctx,
      summary,
      bestShoot,
      {
        ...current,
        salvageStartTurn: Math.max(12, current.salvageStartTurn - 1),
        exploitThreshold: Math.max(0.4, current.exploitThreshold - 0.05),
      },
      candidateQuestions,
    ),
  };
}

function evaluatePolicyPreview(
  ctx: TurnContext,
  summary: WorldBeliefSummary,
  bestShoot: { hitProb: number; boardValue: number },
  policy: PolicyPreviewState,
  candidateQuestions: number,
): number {
  const questionMode = deriveQuestionModeForPolicy(ctx, summary, policy);
  const questionBudgetOpen = isQuestionBudgetOpenForPolicy(ctx, questionMode, policy);
  let bestQuestionValue = 0;

  if (questionMode !== "none" && questionBudgetOpen && asNumber(ctx.bridge.data.questionsRemaining, 0) > 0) {
    const questions = selectQuestionsForMode(questionMode, ctx.askedQuestions).slice(0, candidateQuestions);
    for (const question of questions) {
      try {
        const detail = evaluateWorldQuestionDetailed(
          ctx.bridge,
          question,
          ctx.particles,
          ctx.epsilon,
        );
        const score = questionMode === "coarse"
          ? scoreCoarseQuestion(summary, question, detail.value, detail.pYes)
          : scoreSalvageQuestion(summary, question, detail.value, detail.pYes);
        if (score.adjustedValue > bestQuestionValue) {
          bestQuestionValue = score.adjustedValue;
        }
      } catch {
        // Ignore invalid preview candidates.
      }
    }
  }

  const frontierExploitForced = bestShoot.hitProb >= policy.exploitThreshold;
  const preferQuestion = questionBudgetOpen &&
    bestQuestionValue > bestShoot.boardValue &&
    !frontierExploitForced;

  return preferQuestion ? bestQuestionValue : bestShoot.boardValue;
}

function deriveQuestionModeForPolicy(
  ctx: TurnContext,
  summary: WorldBeliefSummary,
  policy: PolicyPreviewState,
): QuestionMode {
  if (summary.largestHitClusterSize <= 0) return "coarse";
  return asNumber(ctx.bridge.data.turnNumber, 0) >= policy.salvageStartTurn && summary.frontierCount === 0
    ? "late"
    : "local";
}

function isQuestionBudgetOpenForPolicy(
  ctx: TurnContext,
  mode: QuestionMode,
  policy: PolicyPreviewState,
): boolean {
  if (mode === "coarse") {
    return asNumber(ctx.bridge.data.coarseQuestionsUsed, 0) < policy.coarseBudget;
  }
  if (mode === "local") {
    return asNumber(ctx.bridge.data.localQuestionsUsed, 0) < policy.localBudget;
  }
  if (mode === "late") {
    return asNumber(ctx.bridge.data.lateQuestionsUsed, 0) < policy.lateBudget;
  }
  return false;
}

function readQuestionMode(ctx: TurnContext): QuestionMode {
  switch (readString(ctx.bridge.computed.questionFamilyMode)) {
    case "coarse":
    case "local":
    case "late":
      return ctx.bridge.computed.questionBudgetOpen === true
        ? readString(ctx.bridge.computed.questionFamilyMode)! as QuestionMode
        : "none";
    default:
      return "none";
  }
}

function selectQuestionsForMode(
  mode: QuestionMode,
  askedQuestions: Set<string>,
): QuestionDescriptor[] {
  if (mode === "coarse") return selectCoarseQuestions(askedQuestions);
  if (mode === "local") return selectLocalQuestions(askedQuestions);
  if (mode === "late") return selectLateQuestions(askedQuestions);
  return [];
}

function readCurrentPolicyState(ctx: TurnContext): PolicyPreviewState {
  return {
    coarseBudget: asNumber(ctx.bridge.data.coarseBudget, 6),
    localBudget: asNumber(ctx.bridge.data.localBudget, 2),
    lateBudget: asNumber(ctx.bridge.data.lateBudget, 4),
    salvageStartTurn: asNumber(ctx.bridge.data.salvageStartTurn, 16),
    exploitThreshold: asNumber(ctx.bridge.data.exploitThreshold, 0.55),
  };
}

function selectCoarseQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) =>
    isCoarseQuestionFamily(question.family) &&
    !askedQuestions.has(question.id) &&
    !askedQuestions.has(question.text)
  );
}

function selectLocalQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) =>
    isLocalQuestionFamily(question.family) &&
    !askedQuestions.has(question.id) &&
    !askedQuestions.has(question.text)
  );
}

function selectLateQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) => {
    const family = inferQuestionFamilyFromId(question.id);
    const allowed = isCoarseQuestionFamily(family) || family === "block-2x2";
    return allowed &&
      !askedQuestions.has(question.id) &&
      !askedQuestions.has(question.text);
  });
}

function readRevisionPreview(ctx: TurnContext): RevisionPlan {
  return {
    revisionKind: readRevisionKind(ctx.bridge.computed.nextRevisionKind) ?? "coarse_roi_collapse",
    policyMode: readString(ctx.bridge.computed.nextPolicyMode) ?? "default",
    coarseBudget: asNumber(ctx.bridge.computed.nextCoarseBudget, asNumber(ctx.bridge.data.coarseBudget, 6)),
    localBudget: asNumber(ctx.bridge.computed.nextLocalBudget, asNumber(ctx.bridge.data.localBudget, 2)),
    lateBudget: asNumber(ctx.bridge.computed.nextLateBudget, asNumber(ctx.bridge.data.lateBudget, 4)),
    salvageStartTurn: asNumber(
      ctx.bridge.computed.nextSalvageStartTurn,
      asNumber(ctx.bridge.data.salvageStartTurn, 16),
    ),
    exploitThreshold: asNumber(
      ctx.bridge.computed.nextExploitThreshold,
      asNumber(ctx.bridge.data.exploitThreshold, 0.55),
    ),
  };
}

function buildLLMRevisionSystemPrompt(): string {
  return [
    "Choose one reflective policy revision for Battleship.",
    "Return JSON only.",
    'Schema: {"revisionKind":"coarse_roi_collapse|late_diffuse_reprobe|cluster_closeout_bias","coarseBudget":number,"localBudget":number,"lateBudget":number,"salvageStartTurn":number,"exploitThreshold":number,"policyMode":string}',
    "If you omit a numeric field, the default symbolic preview will be used.",
    "Keep budgets non-negative and total budgets at or below 15.",
    "Keep exploitThreshold between 0 and 1.",
  ].join("\n");
}

function buildLLMRevisionUserPrompt(
  snapshot: ReturnType<typeof summarizeSnapshot>,
  preview: RevisionPlan,
): string {
  const prompt = {
    task: "Revise reflective policy under low-confidence model mismatch.",
    state: {
      turnNumber: snapshot.turnNumber ?? null,
      modelConfidence: snapshot.modelConfidence ?? null,
      confidenceThreshold: snapshot.confidenceThreshold ?? null,
      predictionErrorEMA: snapshot.predictionErrorEMA ?? null,
      calibrationErrorEMA: snapshot.calibrationErrorEMA ?? null,
      frontierCount: snapshot.worldFrontierCount ?? null,
      largestHitClusterSize: snapshot.largestHitClusterSize ?? null,
      bestHitProb: snapshot.bestHitProb ?? null,
      bestQuestionValue: snapshot.bestQuestionValue ?? null,
      questionsRemaining: snapshot.questionsRemaining ?? null,
      policyMode: snapshot.policyMode ?? null,
      questionFamilyMode: snapshot.questionFamilyMode ?? null,
      needRevision: snapshot.needRevision ?? null,
    },
    symbolicPreview: preview,
  };
  return JSON.stringify(prompt, null, 2);
}

function parseRevisionProposal(raw: string, defaults: RevisionPlan): RevisionPlan | null {
  try {
    const parsed = parseJsonObject(raw);
    const revisionKind = readRevisionKind(parsed.revisionKind);
    if (!revisionKind) {
      return null;
    }
    return {
      revisionKind,
      policyMode: typeof parsed.policyMode === "string" && parsed.policyMode.length > 0
        ? parsed.policyMode
        : defaults.policyMode,
      coarseBudget: readInteger(parsed.coarseBudget, defaults.coarseBudget),
      localBudget: readInteger(parsed.localBudget, defaults.localBudget),
      lateBudget: readInteger(parsed.lateBudget, defaults.lateBudget),
      salvageStartTurn: readInteger(parsed.salvageStartTurn, defaults.salvageStartTurn),
      exploitThreshold: readFiniteNumber(parsed.exploitThreshold, defaults.exploitThreshold),
    };
  } catch {
    return null;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("JSON_OBJECT_NOT_FOUND");
    }
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function readRevisionKind(value: unknown): RevisionKind | null {
  switch (value) {
    case "coarse_roi_collapse":
    case "late_diffuse_reprobe":
    case "cluster_closeout_bias":
      return value;
    default:
      return null;
  }
}

function readInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  return fallback;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
