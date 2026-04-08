import { findTemplateQuestionById } from "../../../questions/template-questions.js";
import { compileQuestionSpec } from "../../../questions/question-spec.js";
import { readWorldCells } from "../../../runtime/world-frontier.js";
import type { ExperimentPipelineStage } from "../../../pipeline/experiment-pipeline.js";
import type { DecisionResolution, SalvageCompileInput } from "./types.js";

export function createSalvageCompileStage(): ExperimentPipelineStage<SalvageCompileInput, DecisionResolution | null> {
  return {
    name: "wma_salvage_compile",
    async run(input) {
      const resolution = resolveLLMChoice(input);
      const fallbackReason = resolution
        ? null
        : (input.llmResult.errorMessage ? "llm_effect_unavailable" : "llm_response_invalid_for_candidate_set");

      return {
        value: resolution,
        status: resolution ? "success" : "fallback",
        proposalKind: resolution?.decision.action ?? input.llmResult.choice?.action ?? null,
        metadata: {
          usedFallback: !resolution,
          fallbackReason,
          latencyMs: input.llmResult.latencyMs,
          questionSource: resolution?.questionSource ?? null,
          questionSpec: resolution?.questionSpec ?? null,
        },
      };
    },
  };
}

function resolveLLMChoice(input: SalvageCompileInput): DecisionResolution | null {
  const { bundle, llmResult } = input;
  const choice = llmResult.choice;
  if (!choice) {
    return null;
  }

  if (choice.action === "shoot" && choice.cellId) {
    const candidate = bundle.topShootCandidates.find((entry) => entry.cellId === choice.cellId);
    if (!candidate) {
      return null;
    }
    return {
      decision: {
        action: "shoot",
        cellId: candidate.cellId,
        cellIndex: candidate.cellIndex,
      },
    };
  }

  if (choice.action === "question" && choice.questionId) {
    const candidate = bundle.topQuestionCandidates.find((entry) => entry.question.id === choice.questionId);
    const descriptor = candidate?.question ?? findTemplateQuestionById(choice.questionId);
    if (!descriptor) {
      return null;
    }
    return {
      decision: {
        action: "question",
        questionId: descriptor.id,
        questionText: descriptor.text,
        questionSource: descriptor.source ?? "template",
        evaluate: descriptor.evaluate,
      },
      questionSource: descriptor.source ?? "template",
    };
  }

  if (choice.action === "question" && choice.questionSpec) {
    const compiled = compileQuestionSpec(choice.questionSpec, {
      worldCells: readWorldCells(bundle.ctx.bridge),
      frontierCellIds: bundle.summary.frontierCellIds,
      hitClusters: bundle.summary.hitClusters,
      askedQuestions: bundle.ctx.askedQuestions,
    });
    if (!compiled.ok) {
      return null;
    }

    const templateDescriptor = findTemplateQuestionById(compiled.descriptor.id);
    const descriptor = templateDescriptor ?? compiled.descriptor;
    const questionSource = templateDescriptor ? "template" : "synthesized";

    return {
      decision: {
        action: "question",
        questionId: descriptor.id,
        questionText: descriptor.text,
        questionSource,
        questionSpec: choice.questionSpec,
        evaluate: descriptor.evaluate,
      },
      questionSource,
      questionSpec: choice.questionSpec,
    };
  }

  return null;
}
