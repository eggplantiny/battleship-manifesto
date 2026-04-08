import type { SimResult } from "../core/simulation.js";
import {
  COARSE_QUESTION_FAMILIES,
  LOCAL_QUESTION_FAMILIES,
  classifyQuestionBudgetBucket,
  type QuestionFamily,
} from "../questions/template-questions.js";
import type { TurnDecision, TurnContext } from "./strategy.js";
import type { GateState, MMPCandidateBundle, ScoredQuestion } from "./mmp-kernel.js";

export interface MMPPolicyState {
  policyName: string;
  noisePenalty: number;
  effectiveQuestionValue: number;
  effectiveQuestionEdge: number | null;
  llmBudgetRemaining: number;
  lateGame: boolean;
  questionBudgetTight: boolean;
  shouldExplore: boolean;
  tinyQuestionEdge: boolean;
  highHitProbability: boolean;
  firstHitFound: boolean;
  preHitQuestionCapReached: boolean;
  underQuestionTarget: boolean;
  questionShortfall: number;
  questionDecay: number;
  bestMacroPlanKind: "probe" | "exploit" | "closeout";
  macroPlanGap: number;
  diffusePosterior: boolean;
  collapsedPosterior: boolean;
  highConfidenceFrontier: boolean;
  shipFitTight: boolean;
  questionROIPositive: boolean;
  coarseQuestionsUsed: number;
  localQuestionsUsed: number;
  lateQuestionsUsed: number;
  coarseBudgetRemaining: number;
  localBudgetRemaining: number;
  lateBudgetRemaining: number;
  macroExplorePreferred: boolean;
  macroExploitPreferred: boolean;
}

export interface MMPPolicyDecision {
  usedLLM: boolean;
  reason: string;
  valueGap: number | null;
  autoDecision?: TurnDecision;
  policyName: string;
  noisePenalty: number;
  effectiveQuestionValue: number;
  llmBudgetRemaining: number;
}

export interface QuestionPoolPolicy {
  label: string;
  families: QuestionFamily[];
}

export interface MMPPolicy {
  readonly name: string;
  selectQuestionPool(args: {
    ctx: TurnContext;
    llmTurnsUsed: number;
  }): QuestionPoolPolicy;
  computeState(args: {
    ctx: TurnContext;
    bundle: MMPCandidateBundle;
    bestShoot: SimResult;
    bestQuestion: ScoredQuestion | null;
    llmTurnsUsed: number;
  }): MMPPolicyState;
  chooseGate(args: {
    ctx: TurnContext;
    bestShoot: SimResult;
    bestQuestion: ScoredQuestion | null;
    gateState: GateState;
    policyState: MMPPolicyState;
  }): MMPPolicyDecision;
}

interface PolicyConfig {
  name: string;
  epsilonPenaltyFloor: number;
  epsilonPenaltyMode: "noise-aware" | "oracle";
  earlyExploreTurns: number;
  richQuestionBudget: number;
  questionBudgetTightThreshold: number;
  lateGameTurn: number;
  lateGameShotsRemaining: number;
  lateGameShipCellsRemaining: number;
  slightQuestionEdge: number;
  questionDominanceEdge: number;
  lateQuestionDominanceEdge: number;
  tinyQuestionEdge: number;
  llmBandMin: number;
  llmBandMax: number;
  llmBudget: number;
  highHitProb: number;
  preFirstHitQuestionCap: number;
  coarseBudget: number;
  localBudget: number;
  lateBudget: number;
  preFirstHitExploreBonus: number;
  targetQuestions: number;
  targetQuestionTurn: number;
  underQuestionTargetBonus: number;
  underQuestionTargetEdge: number;
  minMacroProbeGap: number;
  minROIForLocalQuestion: number;
  minROIForLateQuestion: number;
  decayStartTurn: number;
  decayEndTurn: number;
  decayFloor: number;
}

export interface MMPPolicyOverrides {
  targetQuestions?: number;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
}

class ThresholdMMPPolicy implements MMPPolicy {
  readonly name: string;

  constructor(private readonly config: PolicyConfig) {
    this.name = config.name;
  }

  selectQuestionPool(args: {
    ctx: TurnContext;
    llmTurnsUsed: number;
  }): QuestionPoolPolicy {
    const { ctx } = args;
    const data = ctx.bridge.data;
    const turn = ((data.turnNumber as number) ?? 0) + 1;
    const hitCount = (data.hitCount as number) ?? 0;
    const budgets = this.computeBudgetState(ctx);
    const preFirstHitQuestionCap = this.resolvePreFirstHitQuestionCap();

    if (
      hitCount === 0 &&
      budgets.coarseQuestionsUsed < preFirstHitQuestionCap &&
      budgets.coarseBudgetRemaining > 0 &&
      turn <= this.config.earlyExploreTurns
    ) {
      return { label: "coarse-open", families: [...COARSE_QUESTION_FAMILIES] };
    }

    if (turn >= this.config.lateGameTurn && budgets.lateBudgetRemaining > 0) {
      return { label: "late-salvage", families: [...COARSE_QUESTION_FAMILIES, ...LOCAL_QUESTION_FAMILIES] };
    }

    if (budgets.localBudgetRemaining > 0 && budgets.coarseBudgetRemaining > 0) {
      return { label: "mixed", families: [...COARSE_QUESTION_FAMILIES, ...LOCAL_QUESTION_FAMILIES] };
    }

    if (budgets.localBudgetRemaining > 0) {
      return { label: "local-focus", families: [...LOCAL_QUESTION_FAMILIES] };
    }

    if (budgets.coarseBudgetRemaining > 0) {
      return { label: "coarse-only", families: [...COARSE_QUESTION_FAMILIES] };
    }

    return { label: "none", families: [] };
  }

  computeState(args: {
    ctx: TurnContext;
    bundle: MMPCandidateBundle;
    bestShoot: SimResult;
    bestQuestion: ScoredQuestion | null;
    llmTurnsUsed: number;
  }): MMPPolicyState {
    const { ctx, bundle, bestShoot, bestQuestion, llmTurnsUsed } = args;
    const data = ctx.bridge.data;
    const computed = ctx.bridge.computed;
    const turn = ((data.turnNumber as number) ?? 0) + 1;
    const questionsRemaining = (data.questionsRemaining as number) ?? 0;
    const questionsAsked = (data.questionsAsked as number) ?? 0;
    const shotsRemaining = (data.shotsRemaining as number) ?? 0;
    const hitCount = (data.hitCount as number) ?? 0;
    const totalShipCells = (data.totalShipCells as number) ?? 0;
    const shipCellsRemaining = Math.max(0, totalShipCells - hitCount);
    const budgets = this.computeBudgetState(ctx);
    const questionShortfall = Math.max(0, this.resolveTargetQuestions() - questionsAsked);
    const preFirstHitQuestionCap = this.resolvePreFirstHitQuestionCap();
    const firstHitFound = hitCount > 0;
    const preHitQuestionCapReached =
      !firstHitFound &&
      budgets.coarseQuestionsUsed >= preFirstHitQuestionCap;
    const lateGame =
      turn >= this.config.lateGameTurn ||
      shotsRemaining <= this.config.lateGameShotsRemaining ||
      shipCellsRemaining <= this.config.lateGameShipCellsRemaining;
    const questionBudgetTight = questionsRemaining <= this.config.questionBudgetTightThreshold;
    const underQuestionTarget =
      questionShortfall > 0 &&
      turn <= this.config.targetQuestionTurn &&
      !lateGame &&
      !questionBudgetTight &&
      (!preHitQuestionCapReached || firstHitFound);

    const noisePenalty = this.computeNoisePenalty(ctx.epsilon);
    const questionDecay = this.computeQuestionDecay(turn);
    const rawQuestionValue = bestQuestion?.value ?? 0;
    const exploreBonus = !firstHitFound && !preHitQuestionCapReached && isCoarseQuestion(bestQuestion)
      ? this.config.preFirstHitExploreBonus
      : 0;
    const underTargetBonus = underQuestionTarget
      ? Math.min(questionShortfall, 3) * this.config.underQuestionTargetBonus
      : 0;
    const roiBonus = bundle.beliefSummary.recentQuestionROI > this.config.minROIForLocalQuestion
      ? 0.002
      : 0;
    const effectiveQuestionValue =
      (rawQuestionValue * noisePenalty * questionDecay) +
      exploreBonus +
      underTargetBonus +
      roiBonus;
    const effectiveQuestionEdge = bestQuestion
      ? effectiveQuestionValue - bestShoot.boardValue
      : null;
    const llmBudgetRemaining = Math.max(0, this.config.llmBudget - llmTurnsUsed);
    const shouldExplore =
      turn <= this.config.earlyExploreTurns &&
      questionsRemaining > this.config.richQuestionBudget &&
      !preHitQuestionCapReached;
    const tinyQuestionEdge =
      effectiveQuestionEdge !== null &&
      effectiveQuestionEdge > 0 &&
      effectiveQuestionEdge <= this.config.tinyQuestionEdge;

    return {
      policyName: this.name,
      noisePenalty,
      effectiveQuestionValue,
      effectiveQuestionEdge,
      llmBudgetRemaining,
      lateGame,
      questionBudgetTight,
      shouldExplore,
      tinyQuestionEdge,
      highHitProbability: bestShoot.hitProb >= this.config.highHitProb,
      firstHitFound,
      preHitQuestionCapReached,
      underQuestionTarget,
      questionShortfall,
      questionDecay,
      bestMacroPlanKind: bundle.macroPlans.bestMacroPlanKind,
      macroPlanGap: readNumber(computed.macroPlanGap),
      diffusePosterior: readBoolean(computed.diffusePosterior),
      collapsedPosterior: readBoolean(computed.collapsedPosterior),
      highConfidenceFrontier: readBoolean(computed.highConfidenceFrontier),
      shipFitTight: readBoolean(computed.shipFitTight),
      questionROIPositive: readBoolean(computed.questionROIPositive),
      coarseQuestionsUsed: budgets.coarseQuestionsUsed,
      localQuestionsUsed: budgets.localQuestionsUsed,
      lateQuestionsUsed: budgets.lateQuestionsUsed,
      coarseBudgetRemaining: budgets.coarseBudgetRemaining,
      localBudgetRemaining: budgets.localBudgetRemaining,
      lateBudgetRemaining: budgets.lateBudgetRemaining,
      macroExplorePreferred: readBoolean(computed.macroExplorePreferred),
      macroExploitPreferred: readBoolean(computed.macroExploitPreferred),
    };
  }

  chooseGate(args: {
    ctx: TurnContext;
    bestShoot: SimResult;
    bestQuestion: ScoredQuestion | null;
    gateState: GateState;
    policyState: MMPPolicyState;
  }): MMPPolicyDecision {
    const { bestShoot, bestQuestion, policyState } = args;
    const valueGap = policyState.effectiveQuestionEdge;

    if (!bestQuestion) {
      return this.autoShoot("no_question_available", bestShoot, policyState, valueGap);
    }

    if (policyState.preHitQuestionCapReached && !policyState.diffusePosterior && (valueGap ?? 0) < this.config.questionDominanceEdge) {
      return this.autoShoot("pre_hit_question_cap_reached", bestShoot, policyState, valueGap);
    }

    if (policyState.highHitProbability && !policyState.macroExplorePreferred && (valueGap ?? 0) < this.config.questionDominanceEdge) {
      return this.autoShoot("high_hit_probability", bestShoot, policyState, valueGap);
    }

    if (policyState.lateGame && !policyState.questionROIPositive && (valueGap ?? 0) < this.config.lateQuestionDominanceEdge) {
      return this.autoShoot("late_game_suppression", bestShoot, policyState, valueGap);
    }

    if (policyState.questionBudgetTight && (valueGap ?? 0) < this.config.questionDominanceEdge) {
      return this.autoShoot("question_budget_tight", bestShoot, policyState, valueGap);
    }

    if (valueGap === null || valueGap <= 0 || policyState.tinyQuestionEdge) {
      return this.autoShoot("tiny_margin_autoshoot", bestShoot, policyState, valueGap);
    }

    if (
      policyState.bestMacroPlanKind === "probe" &&
      policyState.macroPlanGap >= this.config.minMacroProbeGap &&
      (policyState.macroExplorePreferred || policyState.underQuestionTarget)
    ) {
      return this.autoQuestion("macro_probe_dominates", bestQuestion, policyState, valueGap);
    }

    if (policyState.shouldExplore && valueGap > this.config.slightQuestionEdge) {
      return this.autoQuestion("coarse_opening_probe", bestQuestion, policyState, valueGap);
    }

    if (policyState.underQuestionTarget && valueGap > this.config.underQuestionTargetEdge) {
      return this.autoQuestion("under_question_target", bestQuestion, policyState, valueGap);
    }

    if (valueGap >= this.config.questionDominanceEdge && !policyState.macroExploitPreferred) {
      return this.autoQuestion("question_dominates", bestQuestion, policyState, valueGap);
    }

    if (
      policyState.llmBudgetRemaining > 0 &&
      policyState.firstHitFound &&
      valueGap >= this.config.llmBandMin &&
      valueGap <= this.config.llmBandMax &&
      !policyState.lateGame &&
      !policyState.macroExplorePreferred &&
      !policyState.macroExploitPreferred
    ) {
      return {
        usedLLM: true,
        reason: "llm_bandpass",
        valueGap,
        policyName: policyState.policyName,
        noisePenalty: policyState.noisePenalty,
        effectiveQuestionValue: policyState.effectiveQuestionValue,
        llmBudgetRemaining: policyState.llmBudgetRemaining,
      };
    }

    return this.autoShoot("noise_penalized_shoot", bestShoot, policyState, valueGap);
  }

  private autoShoot(
    reason: string,
    bestShoot: SimResult,
    policyState: MMPPolicyState,
    valueGap: number | null,
  ): MMPPolicyDecision {
    return {
      usedLLM: false,
      reason,
      valueGap,
      autoDecision: {
        action: "shoot",
        cellId: bestShoot.cell,
      },
      policyName: policyState.policyName,
      noisePenalty: policyState.noisePenalty,
      effectiveQuestionValue: policyState.effectiveQuestionValue,
      llmBudgetRemaining: policyState.llmBudgetRemaining,
    };
  }

  private autoQuestion(
    reason: string,
    bestQuestion: ScoredQuestion,
    policyState: MMPPolicyState,
    valueGap: number | null,
  ): MMPPolicyDecision {
    return {
      usedLLM: false,
      reason,
      valueGap,
      autoDecision: {
        action: "question",
        questionId: bestQuestion.id,
        questionText: bestQuestion.text,
        evaluate: bestQuestion.evaluate,
      },
      policyName: policyState.policyName,
      noisePenalty: policyState.noisePenalty,
      effectiveQuestionValue: policyState.effectiveQuestionValue,
      llmBudgetRemaining: policyState.llmBudgetRemaining,
    };
  }

  private computeNoisePenalty(epsilon: number): number {
    if (this.config.epsilonPenaltyMode === "oracle") {
      return 1;
    }

    const reliability = 1 - (2 * epsilon);
    return Math.max(this.config.epsilonPenaltyFloor, reliability * reliability);
  }

  private computeQuestionDecay(turn: number): number {
    if (turn <= this.config.decayStartTurn) {
      return 1;
    }
    if (turn >= this.config.decayEndTurn) {
      return this.config.decayFloor;
    }

    const progress = (turn - this.config.decayStartTurn) /
      (this.config.decayEndTurn - this.config.decayStartTurn);
    return 1 - (progress * (1 - this.config.decayFloor));
  }

  private resolvePreFirstHitQuestionCap(): number {
    return Math.max(this.config.preFirstHitQuestionCap, this.config.coarseBudget);
  }

  private resolveTargetQuestions(): number {
    return this.config.targetQuestions > 0
      ? this.config.targetQuestions
      : this.config.coarseBudget + this.config.localBudget + this.config.lateBudget;
  }

  private computeBudgetState(ctx: TurnContext): {
    coarseQuestionsUsed: number;
    localQuestionsUsed: number;
    lateQuestionsUsed: number;
    coarseBudgetRemaining: number;
    localBudgetRemaining: number;
    lateBudgetRemaining: number;
  } {
    let coarseQuestionsUsed = 0;
    let localQuestionsUsed = 0;
    let lateQuestionsUsed = 0;

    for (const question of ctx.gameState.questions.values()) {
      const bucket = classifyQuestionBudgetBucket(question.id, question.turnAsked, this.config.lateGameTurn);
      if (bucket === "coarse") coarseQuestionsUsed += 1;
      if (bucket === "local") localQuestionsUsed += 1;
      if (bucket === "late") lateQuestionsUsed += 1;
    }

    return {
      coarseQuestionsUsed,
      localQuestionsUsed,
      lateQuestionsUsed,
      coarseBudgetRemaining: Math.max(0, this.config.coarseBudget - coarseQuestionsUsed),
      localBudgetRemaining: Math.max(0, this.config.localBudget - localQuestionsUsed),
      lateBudgetRemaining: Math.max(0, this.config.lateBudget - lateQuestionsUsed),
    };
  }
}

export function createPaperMMPPolicy(overrides: MMPPolicyOverrides = {}): MMPPolicy {
  return new ThresholdMMPPolicy({
    name: "mmp-paper",
    epsilonPenaltyFloor: 0.55,
    epsilonPenaltyMode: "noise-aware",
    earlyExploreTurns: 6,
    richQuestionBudget: 9,
    questionBudgetTightThreshold: 5,
    lateGameTurn: 25,
    lateGameShotsRemaining: 15,
    lateGameShipCellsRemaining: 4,
    slightQuestionEdge: 0.004,
    questionDominanceEdge: 0.03,
    lateQuestionDominanceEdge: 0.055,
    tinyQuestionEdge: 0.002,
    llmBandMin: 0.006,
    llmBandMax: 0.02,
    llmBudget: 3,
    highHitProb: 0.74,
    preFirstHitQuestionCap: 3,
    coarseBudget: overrides.coarseBudget ?? 3,
    localBudget: overrides.localBudget ?? 3,
    lateBudget: overrides.lateBudget ?? 1,
    preFirstHitExploreBonus: 0.01,
    targetQuestions: overrides.targetQuestions ?? 6,
    targetQuestionTurn: 20,
    underQuestionTargetBonus: 0.003,
    underQuestionTargetEdge: 0.002,
    minMacroProbeGap: 0.008,
    minROIForLocalQuestion: 0.01,
    minROIForLateQuestion: 0.02,
    decayStartTurn: 25,
    decayEndTurn: 40,
    decayFloor: 0.35,
  });
}

export function createLiteMMPPolicy(overrides: MMPPolicyOverrides = {}): MMPPolicy {
  return new ThresholdMMPPolicy({
    name: "mmp-paper-lite",
    epsilonPenaltyFloor: 0.5,
    epsilonPenaltyMode: "noise-aware",
    earlyExploreTurns: 5,
    richQuestionBudget: 10,
    questionBudgetTightThreshold: 5,
    lateGameTurn: 22,
    lateGameShotsRemaining: 14,
    lateGameShipCellsRemaining: 5,
    slightQuestionEdge: 0.005,
    questionDominanceEdge: 0.035,
    lateQuestionDominanceEdge: 0.06,
    tinyQuestionEdge: 0.003,
    llmBandMin: 0.008,
    llmBandMax: 0.016,
    llmBudget: 2,
    highHitProb: 0.72,
    preFirstHitQuestionCap: 2,
    coarseBudget: overrides.coarseBudget ?? 2,
    localBudget: overrides.localBudget ?? 2,
    lateBudget: overrides.lateBudget ?? 0,
    preFirstHitExploreBonus: 0.008,
    targetQuestions: overrides.targetQuestions ?? 4,
    targetQuestionTurn: 18,
    underQuestionTargetBonus: 0.002,
    underQuestionTargetEdge: 0.003,
    minMacroProbeGap: 0.01,
    minROIForLocalQuestion: 0.012,
    minROIForLateQuestion: 0.03,
    decayStartTurn: 22,
    decayEndTurn: 36,
    decayFloor: 0.25,
  });
}

export function createOracleMMPPolicy(overrides: MMPPolicyOverrides = {}): MMPPolicy {
  return new ThresholdMMPPolicy({
    name: "mmp-oracle",
    epsilonPenaltyFloor: 1,
    epsilonPenaltyMode: "oracle",
    earlyExploreTurns: 10,
    richQuestionBudget: 8,
    questionBudgetTightThreshold: 3,
    lateGameTurn: 17,
    lateGameShotsRemaining: 10,
    lateGameShipCellsRemaining: 3,
    slightQuestionEdge: 0.005,
    questionDominanceEdge: 0.028,
    lateQuestionDominanceEdge: 0.05,
    tinyQuestionEdge: 0.003,
    llmBandMin: 0.004,
    llmBandMax: 0.03,
    llmBudget: 10,
    highHitProb: 0.8,
    preFirstHitQuestionCap: 4,
    coarseBudget: overrides.coarseBudget ?? 4,
    localBudget: overrides.localBudget ?? 5,
    lateBudget: overrides.lateBudget ?? 1,
    preFirstHitExploreBonus: 0.01,
    targetQuestions: overrides.targetQuestions ?? 10,
    targetQuestionTurn: 28,
    underQuestionTargetBonus: 0.004,
    underQuestionTargetEdge: 0.002,
    minMacroProbeGap: 0.006,
    minROIForLocalQuestion: 0,
    minROIForLateQuestion: 0,
    decayStartTurn: 30,
    decayEndTurn: 40,
    decayFloor: 0.8,
  });
}

export function createMCMCMMPPolicy(overrides: MMPPolicyOverrides = {}): MMPPolicy {
  return new ThresholdMMPPolicy({
    name: "mmp-paper-mcmc",
    epsilonPenaltyFloor: 0.58,
    epsilonPenaltyMode: "noise-aware",
    earlyExploreTurns: 8,
    richQuestionBudget: 8,
    questionBudgetTightThreshold: 4,
    lateGameTurn: 24,
    lateGameShotsRemaining: 14,
    lateGameShipCellsRemaining: 4,
    slightQuestionEdge: 0.004,
    questionDominanceEdge: 0.028,
    lateQuestionDominanceEdge: 0.05,
    tinyQuestionEdge: 0.002,
    llmBandMin: 0.006,
    llmBandMax: 0.024,
    llmBudget: 5,
    highHitProb: 0.74,
    preFirstHitQuestionCap: 3,
    coarseBudget: overrides.coarseBudget ?? 3,
    localBudget: overrides.localBudget ?? 4,
    lateBudget: overrides.lateBudget ?? 1,
    preFirstHitExploreBonus: 0.01,
    targetQuestions: overrides.targetQuestions ?? 7,
    targetQuestionTurn: 22,
    underQuestionTargetBonus: 0.0035,
    underQuestionTargetEdge: 0.002,
    minMacroProbeGap: 0.007,
    minROIForLocalQuestion: 0.008,
    minROIForLateQuestion: 0.015,
    decayStartTurn: 25,
    decayEndTurn: 40,
    decayFloor: 0.4,
  });
}

function isCoarseQuestion(question: ScoredQuestion | null): boolean {
  return question !== null && COARSE_QUESTION_FAMILIES.includes(question.family);
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
