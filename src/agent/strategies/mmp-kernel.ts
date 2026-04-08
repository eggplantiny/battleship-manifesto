import {
  evaluateAllCells,
  evaluateCloseoutPlan,
  evaluateExploitPlan,
  evaluateQuestion,
  type SimResult,
} from "../core/simulation.js";
import {
  classifyQuestionBudgetBucket,
  selectTemplateQuestions,
  type QuestionFamily,
} from "../questions/template-questions.js";
import type { TurnContext, TurnDecision } from "./strategy.js";

export interface ScoredQuestion {
  id: string;
  family: QuestionFamily;
  text: string;
  evaluate: (board: any) => boolean;
  value: number;
}

export interface BeliefSummary {
  bestHitProb: number;
  secondHitProb: number;
  top2HitGap: number;
  posteriorEntropy: number;
  frontierCellCount: number;
  remainingFitLength2: number;
  remainingFitLength3: number;
  remainingFitLength4: number;
  remainingFitLength5: number;
  totalRemainingFitCount: number;
  recentQuestionROI: number;
  coarseQuestionsUsed: number;
  localQuestionsUsed: number;
  lateQuestionsUsed: number;
}

export interface MacroPlanState {
  probePlanValue: number;
  exploitPlanValue: number;
  closeoutPlanValue: number;
  bestMacroPlanKind: "probe" | "exploit" | "closeout";
  bestMacroPlanValue: number;
}

export interface MMPCandidateBundle {
  turn: number;
  questionPoolLabel: string;
  questionFamilies: readonly QuestionFamily[];
  topShootCandidates: SimResult[];
  bestShoot: SimResult;
  bestQuestion: ScoredQuestion | null;
  bestCoarseQuestion: ScoredQuestion | null;
  revealedCells: Set<number>;
  beliefSummary: BeliefSummary;
  macroPlans: MacroPlanState;
}

export interface GateState {
  questionEdge: number | null;
  noiseAwareQuestionEdge: number | null;
  earlyGame: boolean;
  questionBudgetRich: boolean;
  shouldExplore: boolean;
  lateGame: boolean;
  questionBudgetTight: boolean;
  tinyQuestionEdge: boolean;
  autoQuestionPreferred: boolean;
  autoShootPreferred: boolean;
  llmAdjudicationNeeded: boolean;
  llmBudgetAvailable: boolean;
  highConfidenceFrontier: boolean;
  diffusePosterior: boolean;
  collapsedPosterior: boolean;
  shipFitTight: boolean;
  questionROIPositive: boolean;
  macroPlanGap: number | null;
  macroProbeDominates: boolean;
  macroExploitDominates: boolean;
  macroExplorePreferred: boolean;
  macroExploitPreferred: boolean;
}

export interface PolicyTelemetry {
  noisePenalty: number;
  effectiveQuestionValue: number;
  llmBudgetRemaining: number;
}

export interface ResolvedLLMState {
  status: string | null;
  rawResponse: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  decisionAction: string | null;
  decisionCellId: string | null;
  decisionQuestionId: string | null;
  decisionQuestionText: string | null;
}

export class MMPKernel {
  constructor(private readonly candidateQuestions: number) {}

  buildCandidates(
    ctx: TurnContext,
    questionFamilies: readonly QuestionFamily[],
    questionPoolLabel: string,
  ): MMPCandidateBundle {
    const turn = ((ctx.bridge.data.turnNumber as number) ?? 0) + 1;
    const revealedCells = ctx.gameState.getRevealedCellIndices();
    const shootResults = evaluateAllCells(ctx.bridge, ctx.particles, revealedCells);
    const topShootCandidates = shootResults.slice(0, 5);
    const bestShoot = topShootCandidates[0];

    if (!bestShoot) {
      throw new Error("MMP requires at least one shoot candidate");
    }

    const bestQuestion = this.selectBestQuestion(ctx, revealedCells, questionFamilies);
    const bestCoarseQuestion = this.selectBestQuestion(ctx, revealedCells, ["row", "column", "quadrant"]);
    const beliefSummary = this.computeBeliefSummary(ctx, topShootCandidates);
    const macroPlans = this.computeMacroPlans(ctx, revealedCells, bestShoot, bestCoarseQuestion);

    return {
      turn,
      questionPoolLabel,
      questionFamilies,
      topShootCandidates,
      bestShoot,
      bestQuestion,
      bestCoarseQuestion,
      revealedCells,
      beliefSummary,
      macroPlans,
    };
  }

  async recordPlanningState(
    ctx: TurnContext,
    bundle: MMPCandidateBundle,
  ): Promise<void> {
    await ctx.bridge.dispatch("startTurn");
    for (const candidate of bundle.topShootCandidates) {
      await ctx.bridge.dispatch("think", candidate.cell);
      await ctx.bridge.dispatch("recordSimResult", candidate.cell, candidate.hitProb, candidate.boardValue);
    }
    await ctx.bridge.dispatch(
      "recordQuestionCandidate",
      bundle.bestQuestion?.id ?? "",
      bundle.bestQuestion?.text ?? "",
      bundle.bestQuestion?.value ?? 0,
    );
    await ctx.bridge.dispatch(
      "recordBeliefSummary",
      bundle.beliefSummary.bestHitProb,
      bundle.beliefSummary.secondHitProb,
      bundle.beliefSummary.top2HitGap,
      bundle.beliefSummary.posteriorEntropy,
      bundle.beliefSummary.frontierCellCount,
      bundle.beliefSummary.remainingFitLength2,
      bundle.beliefSummary.remainingFitLength3,
      bundle.beliefSummary.remainingFitLength4,
      bundle.beliefSummary.remainingFitLength5,
      bundle.beliefSummary.totalRemainingFitCount,
      bundle.beliefSummary.recentQuestionROI,
    );
    await ctx.bridge.dispatch(
      "recordMacroPlans",
      bundle.macroPlans.probePlanValue,
      bundle.macroPlans.exploitPlanValue,
      bundle.macroPlans.closeoutPlanValue,
      bundle.macroPlans.bestMacroPlanKind,
      bundle.macroPlans.bestMacroPlanValue,
    );
  }

  async recordPolicyState(
    ctx: TurnContext,
    telemetry: PolicyTelemetry,
    bundle: MMPCandidateBundle,
  ): Promise<void> {
    await ctx.bridge.dispatch(
      "recordPolicyState",
      telemetry.noisePenalty,
      telemetry.effectiveQuestionValue,
      telemetry.llmBudgetRemaining,
      bundle.beliefSummary.coarseQuestionsUsed,
      bundle.beliefSummary.localQuestionsUsed,
      bundle.beliefSummary.lateQuestionsUsed,
    );
  }

  buildUserPrompt(
    ctx: TurnContext,
    bundle: MMPCandidateBundle,
    telemetry: PolicyTelemetry,
  ): string {
    const board = ctx.gameState.toAscii();
    const data = ctx.bridge.data;
    const computed = ctx.bridge.computed;

    const candidateLines = bundle.topShootCandidates.map(
      (candidate, index) =>
        `  ${index + 1}. shoot ${candidate.cell} - hitProb=${candidate.hitProb.toFixed(2)}, value=${candidate.boardValue.toFixed(3)}`,
    ).join("\n");

    const questionLine = bundle.bestQuestion
      ? `  askQuestion "${bundle.bestQuestion.text}" - id=${bundle.bestQuestion.id}, rawValue=${bundle.bestQuestion.value.toFixed(3)}, effectiveValue=${telemetry.effectiveQuestionValue.toFixed(3)}`
      : "  (no question candidate)";

    return `${board}
progress: ${((computed.progress as number) * 100).toFixed(1)}%, F1: ${(computed.targetingF1 as number).toFixed(3)}, shotsLeft: ${data.shotsRemaining}, questionsLeft: ${data.questionsRemaining}
spotterNoiseEpsilon: ${ctx.epsilon.toFixed(3)}, questionNoisePenalty: ${telemetry.noisePenalty.toFixed(3)}, llmBudgetRemaining: ${telemetry.llmBudgetRemaining}

Top shoot candidates:
${candidateLines}

Best question:
${questionLine}

Belief summary:
  bestHitProb=${bundle.beliefSummary.bestHitProb.toFixed(3)}
  top2Gap=${bundle.beliefSummary.top2HitGap.toFixed(3)}
  entropy=${bundle.beliefSummary.posteriorEntropy.toFixed(3)}
  frontierCells=${bundle.beliefSummary.frontierCellCount}
  recentQuestionROI=${bundle.beliefSummary.recentQuestionROI.toFixed(3)}

Macro plans:
  probe=${bundle.macroPlans.probePlanValue.toFixed(3)}
  exploit=${bundle.macroPlans.exploitPlanValue.toFixed(3)}
  closeout=${bundle.macroPlans.closeoutPlanValue.toFixed(3)}
  best=${bundle.macroPlans.bestMacroPlanKind}:${bundle.macroPlans.bestMacroPlanValue.toFixed(3)}

Pick one action:`;
  }

  readLLMState(ctx: TurnContext): ResolvedLLMState {
    const data = ctx.bridge.data;
    const telemetry = ctx.effectTelemetry?.consumeLLMDecision();
    return {
      status: readString(data.llmStatus),
      rawResponse: telemetry?.rawResponse ?? null,
      errorMessage: telemetry?.errorMessage ?? null,
      latencyMs: telemetry?.latencyMs ?? null,
      decisionAction: readString(data.llmDecisionAction),
      decisionCellId: readString(data.llmDecisionCellId),
      decisionQuestionId: readString(data.llmDecisionQuestionId),
      decisionQuestionText: readString(data.llmDecisionQuestionText),
    };
  }

  readGateState(ctx: TurnContext): GateState {
    const computed = ctx.bridge.computed;
    return {
      questionEdge: readNumber(computed.questionEdge),
      noiseAwareQuestionEdge: readNumber(computed.noiseAwareQuestionEdge),
      earlyGame: readBoolean(computed.earlyGame),
      questionBudgetRich: readBoolean(computed.questionBudgetRich),
      shouldExplore: readBoolean(computed.shouldExplore),
      lateGame: readBoolean(computed.lateGame),
      questionBudgetTight: readBoolean(computed.questionBudgetTight),
      tinyQuestionEdge: readBoolean(computed.tinyQuestionEdge),
      autoQuestionPreferred: readBoolean(computed.autoQuestionPreferred),
      autoShootPreferred: readBoolean(computed.autoShootPreferred),
      llmAdjudicationNeeded: readBoolean(computed.llmAdjudicationNeeded),
      llmBudgetAvailable: readBoolean(computed.llmBudgetAvailable),
      highConfidenceFrontier: readBoolean(computed.highConfidenceFrontier),
      diffusePosterior: readBoolean(computed.diffusePosterior),
      collapsedPosterior: readBoolean(computed.collapsedPosterior),
      shipFitTight: readBoolean(computed.shipFitTight),
      questionROIPositive: readBoolean(computed.questionROIPositive),
      macroPlanGap: readNumber(computed.macroPlanGap),
      macroProbeDominates: readBoolean(computed.macroProbeDominates),
      macroExploitDominates: readBoolean(computed.macroExploitDominates),
      macroExplorePreferred: readBoolean(computed.macroExplorePreferred),
      macroExploitPreferred: readBoolean(computed.macroExploitPreferred),
    };
  }

  resolveLLMDecision(
    llmState: ResolvedLLMState,
    bundle: MMPCandidateBundle,
  ): TurnDecision | null {
    if (llmState.status !== "success") {
      return null;
    }

    if (llmState.decisionAction === "shoot" && llmState.decisionCellId) {
      const normalizedCell = llmState.decisionCellId.toUpperCase();
      if (bundle.topShootCandidates.some((candidate) => candidate.cell === normalizedCell)) {
        return {
          action: "shoot",
          cellId: normalizedCell,
        };
      }
      return null;
    }

    if (llmState.decisionAction === "question" && bundle.bestQuestion) {
      return {
        action: "question",
        questionId: bundle.bestQuestion.id,
        questionText: bundle.bestQuestion.text,
        evaluate: bundle.bestQuestion.evaluate,
      };
    }

    return null;
  }

  fallbackDecision(bestShoot: SimResult): TurnDecision {
    return {
      action: "shoot",
      cellId: bestShoot.cell,
    };
  }

  private selectBestQuestion(
    ctx: TurnContext,
    revealedCells: Set<number>,
    questionFamilies: readonly QuestionFamily[],
  ): ScoredQuestion | null {
    const data = ctx.bridge.data;
    if ((data.questionsRemaining as number) <= 0 || questionFamilies.length === 0) {
      return null;
    }

    const templates = selectTemplateQuestions(
      this.candidateQuestions,
      ctx.askedQuestions,
      () => ctx.rng.next(),
    );

    let bestQuestion: ScoredQuestion | null = null;
    for (const question of templates) {
      if (!questionFamilies.includes(question.family)) {
        continue;
      }
      try {
        const value = evaluateQuestion(ctx.bridge, question, ctx.particles, revealedCells, ctx.epsilon);
        if (!bestQuestion || value > bestQuestion.value) {
          bestQuestion = {
            id: question.id,
            family: question.family,
            text: question.text,
            evaluate: question.evaluate,
            value,
          };
        }
      } catch {
        // Ignore invalid question templates for the current state.
      }
    }

    return bestQuestion;
  }

  private computeBeliefSummary(
    ctx: TurnContext,
    topShootCandidates: SimResult[],
  ): BeliefSummary {
    const sortedHitProbs = topShootCandidates.map((candidate) => candidate.hitProb).sort((a, b) => b - a);
    const bestHitProb = sortedHitProbs[0] ?? 0;
    const secondHitProb = sortedHitProbs[1] ?? 0;
    const top2HitGap = Math.max(0, bestHitProb - secondHitProb);

    let entropyTotal = 0;
    let frontierCellCount = 0;
    for (const candidate of topShootCandidates) {
      entropyTotal += bernoulliEntropy(candidate.hitProb);
      if (candidate.hitProb >= 0.2 && candidate.hitProb <= 0.8) {
        frontierCellCount += 1;
      }
    }

    const remainingFitLength2 = countViablePlacements(ctx, 2);
    const remainingFitLength3 = countViablePlacements(ctx, 3);
    const remainingFitLength4 = countViablePlacements(ctx, 4);
    const remainingFitLength5 = countViablePlacements(ctx, 5);
    const totalRemainingFitCount =
      remainingFitLength2 + remainingFitLength3 + remainingFitLength4 + remainingFitLength5;

    let coarseQuestionsUsed = 0;
    let localQuestionsUsed = 0;
    let lateQuestionsUsed = 0;
    for (const question of ctx.gameState.questions.values()) {
      const bucket = classifyQuestionBudgetBucket(question.id, question.turnAsked, 24);
      if (bucket === "coarse") coarseQuestionsUsed += 1;
      if (bucket === "local") localQuestionsUsed += 1;
      if (bucket === "late") lateQuestionsUsed += 1;
    }

    return {
      bestHitProb,
      secondHitProb,
      top2HitGap,
      posteriorEntropy: topShootCandidates.length > 0 ? entropyTotal / topShootCandidates.length : 0,
      frontierCellCount,
      remainingFitLength2,
      remainingFitLength3,
      remainingFitLength4,
      remainingFitLength5,
      totalRemainingFitCount,
      recentQuestionROI: 0,
      coarseQuestionsUsed,
      localQuestionsUsed,
      lateQuestionsUsed,
    };
  }

  private computeMacroPlans(
    ctx: TurnContext,
    revealedCells: Set<number>,
    bestShoot: SimResult,
    bestCoarseQuestion: ScoredQuestion | null,
  ): MacroPlanState {
    const probePlanValue = bestCoarseQuestion?.value ?? 0;
    const exploitPlanValue = evaluateExploitPlan(ctx.bridge, bestShoot, ctx.particles, revealedCells);
    const closeoutPlanValue = evaluateCloseoutPlan(ctx.bridge, bestShoot, ctx.particles, revealedCells);

    let bestMacroPlanKind: MacroPlanState["bestMacroPlanKind"] = "probe";
    let bestMacroPlanValue = probePlanValue;
    if (exploitPlanValue > bestMacroPlanValue) {
      bestMacroPlanKind = "exploit";
      bestMacroPlanValue = exploitPlanValue;
    }
    if (closeoutPlanValue > bestMacroPlanValue) {
      bestMacroPlanKind = "closeout";
      bestMacroPlanValue = closeoutPlanValue;
    }

    return {
      probePlanValue,
      exploitPlanValue,
      closeoutPlanValue,
      bestMacroPlanKind,
      bestMacroPlanValue,
    };
  }
}

function bernoulliEntropy(probability: number): number {
  if (probability <= 0 || probability >= 1) {
    return 0;
  }
  return -((probability * Math.log2(probability)) + ((1 - probability) * Math.log2(1 - probability)));
}

function countViablePlacements(ctx: TurnContext, length: number): number {
  let count = 0;
  const cells = [...ctx.gameState.cells.values()];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col <= 8 - length; col++) {
      const segment = cells.filter((cell) => cell.row === row && cell.col >= col && cell.col < col + length);
      if (segment.length === length && segment.every((cell) => cell.status !== "miss")) {
        count += 1;
      }
    }
  }

  for (let col = 0; col < 8; col++) {
    for (let row = 0; row <= 8 - length; row++) {
      const segment = cells.filter((cell) => cell.col === col && cell.row >= row && cell.row < row + length);
      if (segment.length === length && segment.every((cell) => cell.status !== "miss")) {
        count += 1;
      }
    }
  }

  return count;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}
