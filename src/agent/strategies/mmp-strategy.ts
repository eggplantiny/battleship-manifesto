/**
 * MMP Strategy: M computes candidates, policy gates, LLM effect resolves only
 * the remaining ambiguous turns.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeSnapshot } from "../../experiment/logging.js";
import type { GameState } from "../../domain/game-state.js";
import { MMPKernel } from "./mmp-kernel.js";
import type { MMPPolicy } from "./mmp-policies.js";
import type { Strategy, TurnContext, TurnDecision } from "./strategy.js";

const DEFAULT_MODEL = "gemma3:4b-it-qat";

export class MMPStrategy implements Strategy {
  readonly name: string;
  readonly policyName: string;

  private initialized = false;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly kernel: MMPKernel;
  private currentGameState: GameState | null = null;
  private llmTurnsUsed = 0;
  private pendingQuestionBaseline: { bestHitProb: number; top2HitGap: number } | null = null;

  constructor(
    name: string,
    policy: MMPPolicy,
    model: string = DEFAULT_MODEL,
    candidateQuestions: number = 10,
  ) {
    this.name = name;
    this.policyName = policy.name;
    this.model = model;
    this.policy = policy;
    this.kernel = new MMPKernel(candidateQuestions);

    const mel = readFileSync(resolve(import.meta.dirname, "../../domain/battleship-mp.mel"), "utf-8");
    this.systemPrompt = `You are a battleship captain. Your simulation engine evaluates all cells and gives you the top candidates. You make the final decision.

Domain:
${mel}

You are only needed when the tradeoff is ambiguous.
Reply with ONLY one action:
  shoot D6
  askQuestion "Is there a ship in row D?"`;
  }

  private readonly policy: MMPPolicy;

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    this.syncGameState(ctx.gameState);
    const questionPool = this.policy.selectQuestionPool({
      ctx,
      llmTurnsUsed: this.llmTurnsUsed,
    });
    const bundle = this.kernel.buildCandidates(ctx, questionPool.families, questionPool.label);
    if (this.pendingQuestionBaseline) {
      const deltaBestHit = bundle.beliefSummary.bestHitProb - this.pendingQuestionBaseline.bestHitProb;
      const deltaGap = bundle.beliefSummary.top2HitGap - this.pendingQuestionBaseline.top2HitGap;
      bundle.beliefSummary.recentQuestionROI = deltaBestHit + (0.5 * deltaGap);
      this.pendingQuestionBaseline = null;
    }

    if (!this.initialized) {
      this.initialized = true;
      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "system_prompt",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          llm: `ollama:${this.model}`,
          policy: this.policyName,
          prompt: this.systemPrompt,
        },
      });
    }

    ctx.logger?.log({
      turn: bundle.turn,
      source: "strategy:mmp",
      type: "candidate_set",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        policy: this.policyName,
        questionPool: questionPool.label,
        questionFamilies: questionPool.families,
        topShootCandidates: bundle.topShootCandidates.map((candidate, index) => ({
          rank: index + 1,
          cell: candidate.cell,
          hitProb: candidate.hitProb,
          boardValue: candidate.boardValue,
        })),
        bestQuestion: bundle.bestQuestion
          ? {
              id: bundle.bestQuestion.id,
              family: bundle.bestQuestion.family,
              text: bundle.bestQuestion.text,
              value: bundle.bestQuestion.value,
            }
          : null,
        beliefSummary: bundle.beliefSummary,
        macroPlans: bundle.macroPlans,
      },
    });

    try {
      await this.kernel.recordPlanningState(ctx, bundle);
      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "lineage_recorded",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          policy: this.policyName,
          recordedCells: bundle.topShootCandidates.map((candidate) => candidate.cell),
          bestQuestionId: bundle.bestQuestion?.id ?? null,
          questionPool: questionPool.label,
        },
      });
    } catch (error) {
      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "lineage_record_failed",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          policy: this.policyName,
          questionPool: questionPool.label,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }

    const policyState = this.policy.computeState({
      ctx,
      bundle,
      bestShoot: bundle.bestShoot,
      bestQuestion: bundle.bestQuestion,
      llmTurnsUsed: this.llmTurnsUsed,
    });

    try {
      await this.kernel.recordPolicyState(ctx, {
        noisePenalty: policyState.noisePenalty,
        effectiveQuestionValue: policyState.effectiveQuestionValue,
        llmBudgetRemaining: policyState.llmBudgetRemaining,
      }, bundle);
    } catch (error) {
      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "policy_state_record_failed",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          policy: this.policyName,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }

    const gateState = this.kernel.readGateState(ctx);
    const gate = this.policy.chooseGate({
      ctx,
      bestShoot: bundle.bestShoot,
      bestQuestion: bundle.bestQuestion,
      gateState,
      policyState,
    });

    ctx.logger?.log({
      turn: bundle.turn,
      source: "strategy:mmp",
      type: "gate_decision",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        policy: this.policyName,
        usedLLM: gate.usedLLM,
        reason: gate.reason,
        questionPool: questionPool.label,
        questionFamilies: questionPool.families,
        bestShoot: {
          cell: bundle.bestShoot.cell,
          hitProb: bundle.bestShoot.hitProb,
          boardValue: bundle.bestShoot.boardValue,
        },
        bestQuestion: bundle.bestQuestion
          ? {
              id: bundle.bestQuestion.id,
              family: bundle.bestQuestion.family,
              text: bundle.bestQuestion.text,
              value: bundle.bestQuestion.value,
            }
          : null,
        gateState,
        valueGap: gate.valueGap,
        effectiveQuestionValue: gate.effectiveQuestionValue,
        noisePenalty: gate.noisePenalty,
        llmBudgetRemaining: gate.llmBudgetRemaining,
        beliefSummary: bundle.beliefSummary,
        macroPlans: bundle.macroPlans,
      },
    });

    let decision: TurnDecision | null = gate.autoDecision ?? null;
    let decisionSource: "auto" | "llm" | "fallback" = "auto";

    if (gate.usedLLM) {
      const prompt = this.kernel.buildUserPrompt(ctx, bundle, {
        noisePenalty: gate.noisePenalty,
        effectiveQuestionValue: gate.effectiveQuestionValue,
        llmBudgetRemaining: gate.llmBudgetRemaining,
      });

      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "llm_effect_requested",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          policy: this.policyName,
          model: this.model,
          prompt,
          candidateCells: bundle.topShootCandidates.map((candidate) => candidate.cell),
          bestQuestionId: bundle.bestQuestion?.id ?? null,
          bestQuestionText: bundle.bestQuestion?.text ?? null,
          effectiveQuestionValue: gate.effectiveQuestionValue,
          noisePenalty: gate.noisePenalty,
          llmBudgetRemaining: gate.llmBudgetRemaining,
        },
      });

      this.llmTurnsUsed += 1;
      ctx.effectTelemetry?.clearLLMDecision();

      try {
        await ctx.bridge.dispatch(
          "requestLLMDecision",
          this.systemPrompt,
          prompt,
          bundle.topShootCandidates.map((candidate) => candidate.cell).join(","),
          bundle.bestQuestion?.id ?? "",
          bundle.bestQuestion?.text ?? "",
        );
      } catch (error) {
        ctx.logger?.log({
          turn: bundle.turn,
          source: "strategy:mmp",
          type: "llm_effect_request_failed",
          snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
          data: {
            policy: this.policyName,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const llmState = this.kernel.readLLMState(ctx);
      ctx.logger?.log({
        turn: bundle.turn,
        source: "strategy:mmp",
        type: "llm_effect_resolved",
        snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
        data: {
          policy: this.policyName,
          ...llmState,
        },
      });

      decision = this.kernel.resolveLLMDecision(llmState, bundle);
      if (decision) {
        decisionSource = "llm";
      } else {
        const fallback = this.kernel.fallbackDecision(bundle.bestShoot);
        decision = fallback;
        decisionSource = "fallback";
        ctx.logger?.log({
          turn: bundle.turn,
          source: "strategy:mmp",
          type: "fallback",
          snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
          data: {
            policy: this.policyName,
            reason: llmState.status === "success"
              ? "llm_response_invalid_for_candidate_set"
              : "llm_effect_unavailable",
            llmStatus: llmState.status,
            llmErrorMessage: llmState.errorMessage,
            llmDecisionAction: llmState.decisionAction,
            llmDecisionCellId: llmState.decisionCellId,
            llmDecisionQuestionId: llmState.decisionQuestionId,
            fallbackCell: fallback.cellId,
            fallbackHitProb: bundle.bestShoot.hitProb,
            fallbackBoardValue: bundle.bestShoot.boardValue,
          },
        });
      }
    }

    if (!decision) {
      decision = this.kernel.fallbackDecision(bundle.bestShoot);
      decisionSource = "fallback";
    }

    try {
      await ctx.bridge.dispatch("commitAction");
    } catch {
      // Keep strategy execution resilient if planning state is unavailable.
    }

    if (decision.action === "question" && decision.questionId) {
      ctx.askedQuestions.add(decision.questionId);
      this.pendingQuestionBaseline = {
        bestHitProb: bundle.beliefSummary.bestHitProb,
        top2HitGap: bundle.beliefSummary.top2HitGap,
      };
    }

    ctx.logger?.log({
      turn: bundle.turn,
      source: "strategy:mmp",
      type: "final_decision",
      snapshot: summarizeSnapshot(ctx.bridge.data, ctx.bridge.computed),
      data: {
        policy: this.policyName,
        source: decisionSource,
        action: decision.action,
        cellId: decision.cellId ?? null,
        questionId: decision.questionId ?? null,
        questionText: decision.questionText ?? null,
      },
    });

    return decision;
  }

  private syncGameState(gameState: GameState): void {
    if (this.currentGameState !== gameState) {
      this.currentGameState = gameState;
      this.llmTurnsUsed = 0;
      this.pendingQuestionBaseline = null;
    }
  }
}
