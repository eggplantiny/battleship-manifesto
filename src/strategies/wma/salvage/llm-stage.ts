import type { LLMClient } from "../../../llm/client.js";
import type { ExperimentPipelineStage, PipelineRuntimeContext } from "../../../pipeline/experiment-pipeline.js";
import { parseQuestionSpec } from "../../../questions/question-spec.js";
import type {
  LLMDecisionChoice,
  LLMExplanationChoice,
  ReasonCode,
  SalvageDecisionPromptInput,
  SalvageLLMDecisionResult,
} from "./types.js";

export function createSalvageDecisionLLMStage(
  llm: LLMClient,
  model: string,
): ExperimentPipelineStage<SalvageDecisionPromptInput, SalvageLLMDecisionResult> {
  return {
    name: "wma_salvage_decision_llm",
    async run(input, ctx) {
      logRequested(ctx, model, {
        phase: "decision",
        router: "weak-board",
        candidateCells: input.bundle.topShootCandidates.map((candidate) => candidate.cellId),
        candidateQuestions: input.bundle.topQuestionCandidates.map((candidate) => candidate.question.id),
      });

      const startedAt = Date.now();
      let choice: LLMDecisionChoice | null = null;
      let errorMessage: string | null = null;

      try {
        const response = await llm.chat([
          { role: "system", content: input.prompt.systemPrompt },
          { role: "user", content: input.prompt.userPrompt },
        ], { json: true });
        choice = parseLLMDecisionChoice(response);
        if (!choice) {
          errorMessage = "decision_response_invalid";
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      const latencyMs = Date.now() - startedAt;
      logResolved(ctx, model, {
        phase: "decision",
        status: choice ? "success" : "error",
        latencyMs,
        decisionAction: choice?.action ?? null,
        decisionCellId: choice?.cellId ?? null,
        decisionQuestionId: choice?.questionId ?? null,
        decisionQuestionSpec: choice?.questionSpec ?? null,
        errorMessage,
      });

      return {
        value: {
          choice,
          latencyMs,
          errorMessage,
        },
        status: choice ? "success" : "error",
        proposalKind: choice?.action ?? null,
        metadata: {
          model,
          phase: "decision",
          latencyMs,
          decisionAction: choice?.action ?? null,
          decisionCellId: choice?.cellId ?? null,
          decisionQuestionId: choice?.questionId ?? null,
          decisionQuestionSpec: choice?.questionSpec ?? null,
          errorMessage,
        },
      };
    },
  };
}

export async function explainDecisionChoice(
  llm: LLMClient,
  model: string,
  systemPrompt: string,
  prompt: string,
  turn: number,
  runtime: Pick<PipelineRuntimeContext, "source" | "logger" | "getSnapshot">,
): Promise<{ reason?: ReasonCode; explanation?: string }> {
  runtime.logger?.log({
    turn,
    source: runtime.source,
    type: "llm_explanation_requested",
    snapshot: runtime.getSnapshot(),
    data: {
      model,
      phase: "explanation",
    },
  });

  const startedAt = Date.now();
  let parsed: LLMExplanationChoice | null = null;
  let errorMessage: string | null = null;

  try {
    const response = await llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ], { json: true });
    parsed = parseLLMExplanationChoice(response);
    if (!parsed || (!parsed.reason && !parsed.explanation)) {
      parsed = null;
      errorMessage = "explanation_response_invalid";
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  runtime.logger?.log({
    turn,
    source: runtime.source,
    type: "llm_explanation_resolved",
    snapshot: runtime.getSnapshot(),
    data: {
      status: parsed ? "success" : "error",
      model,
      phase: "explanation",
      latencyMs: Date.now() - startedAt,
      decisionReason: parsed?.reason ?? null,
      explanation: parsed?.explanation ?? null,
      errorMessage,
    },
  });

  return {
    reason: parsed?.reason,
    explanation: parsed?.explanation,
  };
}

function parseLLMDecisionChoice(raw: string): LLMDecisionChoice | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const action = parsed.action;
    if (action !== "shoot" && action !== "question") {
      return null;
    }

    return {
      action,
      cellId: typeof parsed.cellId === "string" ? parsed.cellId : undefined,
      questionId: typeof parsed.questionId === "string" ? parsed.questionId : undefined,
      questionSpec: parseQuestionSpec(parsed.questionSpec),
    };
  } catch {
    return null;
  }
}

function parseLLMExplanationChoice(raw: string): LLMExplanationChoice | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      reason: parseReasonCode(parsed.reason),
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : undefined,
    };
  } catch {
    return null;
  }
}

function parseReasonCode(value: unknown): ReasonCode | undefined {
  switch (value) {
    case "cluster_split":
    case "region_split":
    case "closeout_shot":
    case "best_hit_prob":
    case "uncertain_recovery":
      return value;
    default:
      return undefined;
  }
}

function logRequested(
  ctx: PipelineRuntimeContext,
  model: string,
  data: Record<string, unknown>,
): void {
  ctx.logger?.log({
    turn: ctx.turn,
    source: ctx.source,
    type: "llm_effect_requested",
    snapshot: ctx.getSnapshot(),
    data: {
      model,
      ...data,
    },
  });
}

function logResolved(
  ctx: PipelineRuntimeContext,
  model: string,
  data: Record<string, unknown>,
): void {
  ctx.logger?.log({
    turn: ctx.turn,
    source: ctx.source,
    type: "llm_effect_resolved",
    snapshot: ctx.getSnapshot(),
    data: {
      model,
      ...data,
    },
  });
}
