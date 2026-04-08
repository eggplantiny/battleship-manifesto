import { evaluateWorldQuestionDetailed } from "../../../runtime/simulation-world.js";
import { scoreCoarseQuestion, scoreSalvageQuestion } from "../../../runtime/world-belief-summary.js";
import {
  getTemplateQuestions,
  inferQuestionFamilyFromId,
  isCoarseQuestionFamily,
  type QuestionDescriptor,
} from "../../../questions/template-questions.js";
import type { ExperimentPipelineStage } from "../../../pipeline/experiment-pipeline.js";
import type { SalvageCandidateBundle, RankedQuestionCandidate, SalvageSummaryState } from "./types.js";

export interface SalvageCandidateConfig {
  coarseQuestionBudget: number;
  lateQuestionBudget: number;
  llmCandidates: number;
}

export function createSalvageCandidateStage(
  config: SalvageCandidateConfig,
): ExperimentPipelineStage<SalvageSummaryState, SalvageCandidateBundle> {
  return {
    name: "wma_salvage_candidates",
    async run(input) {
      const rankedCoarse: RankedQuestionCandidate[] = [];
      const rankedSalvage: RankedQuestionCandidate[] = [];
      const questionsRemaining = Number(input.data.questionsRemaining ?? 0);

      if (questionsRemaining > 0) {
        if (!input.hasKnownHits && input.coarseAsked < config.coarseQuestionBudget) {
          for (const question of selectCoarseQuestions(input.ctx.askedQuestions)) {
            try {
              const detail = evaluateWorldQuestionDetailed(
                input.ctx.bridge,
                question,
                input.ctx.particles,
                input.ctx.epsilon,
              );
              const score = scoreCoarseQuestion(input.summary, question, detail.value, detail.pYes);
              rankedCoarse.push({
                question,
                detail,
                adjustedValue: score.adjustedValue,
                splitQuality: score.splitQuality,
                regionMass: score.regionMass,
              });
            } catch {
              // Skip invalid question/eval pairings.
            }
          }
          rankedCoarse.sort((left, right) => right.adjustedValue - left.adjustedValue);
        }

        if (input.hasKnownHits && input.isLateGame && input.lateAsked < config.lateQuestionBudget) {
          for (const question of selectSalvageQuestions(input.ctx.askedQuestions)) {
            try {
              const detail = evaluateWorldQuestionDetailed(
                input.ctx.bridge,
                question,
                input.ctx.particles,
                input.ctx.epsilon,
              );
              const score = scoreSalvageQuestion(input.summary, question, detail.value, detail.pYes);
              rankedSalvage.push({
                question,
                detail,
                adjustedValue: score.adjustedValue,
                splitQuality: score.splitQuality,
                regionMass: score.regionMass,
                clusterRelevance: score.clusterRelevance,
              });
            } catch {
              // Skip invalid question/eval pairings.
            }
          }
          rankedSalvage.sort((left, right) => right.adjustedValue - left.adjustedValue);
        }
      }

      const bestQuestionCandidate = input.hasKnownHits ? rankedSalvage[0] ?? null : rankedCoarse[0] ?? null;
      const bestQuestion = bestQuestionCandidate?.question ?? null;
      const bestQuestionValue = bestQuestionCandidate?.adjustedValue ?? Number.NEGATIVE_INFINITY;
      const defaultDecision = bestQuestion && bestQuestionValue > input.bestShoot.boardValue
        ? {
            action: "question" as const,
            questionId: bestQuestion.id,
            questionText: bestQuestion.text,
            questionSource: bestQuestion.source ?? "template",
            evaluate: bestQuestion.evaluate,
          }
        : {
            action: "shoot" as const,
            cellId: input.bestShoot.cellId,
            cellIndex: input.bestShoot.cellIndex,
          };
      const defaultReason = bestQuestion && bestQuestionValue > input.bestShoot.boardValue
        ? (input.hasKnownHits ? "salvage_question" : "coarse_explore")
        : (input.hasKnownHits ? "salvage_default_shoot" : "pre_hit_default_shoot");

      const output: SalvageCandidateBundle = {
        ...input,
        rankedCoarse,
        rankedSalvage,
        bestQuestionCandidate,
        bestQuestion,
        bestQuestionValue,
        defaultDecision,
        defaultReason,
        topShootCandidates: input.shootResults.slice(0, Math.max(1, config.llmCandidates)),
        topQuestionCandidates: rankedSalvage.slice(0, Math.max(1, config.llmCandidates)),
      };

      return {
        value: output,
        status: "success",
        metadata: {
          bestQuestionId: bestQuestion?.id ?? null,
          bestQuestionValue: Number.isFinite(bestQuestionValue) ? bestQuestionValue : null,
          coarseCandidateCount: rankedCoarse.length,
          salvageCandidateCount: rankedSalvage.length,
          defaultReason,
        },
      };
    },
  };
}

function selectCoarseQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) =>
    isCoarseQuestionFamily(question.family) &&
    !askedQuestions.has(question.id) &&
    !askedQuestions.has(question.text)
  );
}

function selectSalvageQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) => {
    const family = inferQuestionFamilyFromId(question.id);
    const allowed = isCoarseQuestionFamily(family) || family === "block-2x2";
    return allowed &&
      !askedQuestions.has(question.id) &&
      !askedQuestions.has(question.text);
  });
}
