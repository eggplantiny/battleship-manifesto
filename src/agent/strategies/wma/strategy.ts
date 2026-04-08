import type { Strategy, TurnContext, TurnDecision } from "../strategy.js";
import {
  evaluateAllWorldCells,
  evaluateWorldQuestionDetailed,
} from "../../core/simulation-world.js";
import {
  classifyQuestionBudgetBucket,
  getTemplateQuestions,
  isCoarseQuestionFamily,
  inferQuestionFamilyFromId,
  type QuestionDescriptor,
} from "../../questions/template-questions.js";
import {
  computeWorldBeliefSummary,
  scoreCoarseQuestion,
  scoreSalvageQuestion,
  type SalvageQuestionScore,
  type WorldBeliefSummary,
} from "../../core/world-belief-summary.js";

export class WMAStrategy implements Strategy {
  name = "wma";
  private coarseQuestionBudget: number;
  private lateQuestionBudget: number;
  private lateGameTurn = 18;

  constructor(
    private candidateQuestions: number = 10,
    targetQuestions: number = 12,
  ) {
    this.coarseQuestionBudget = Math.max(0, Math.min(6, targetQuestions));
    this.lateQuestionBudget = Math.max(0, targetQuestions - this.coarseQuestionBudget);
  }

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const shootResults = evaluateAllWorldCells(ctx.bridge, ctx.particles);
    if (shootResults.length === 0) {
      throw new Error("WMA found no dispatchable shoot candidates");
    }
    const bestShoot = shootResults[0];
    const summary = computeWorldBeliefSummary(ctx.bridge, ctx.particles, bestShoot.hitProb);

    const frontierCellIds = summary.frontierCellIds;
    if (frontierCellIds.size > 0) {
      const bestFrontier = shootResults.find((candidate) => frontierCellIds.has(candidate.cellId));
      if (bestFrontier) {
        await recordWorldSummary(ctx, summary, null);
        return {
          action: "shoot",
          cellId: bestFrontier.cellId,
          cellIndex: bestFrontier.cellIndex,
        };
      }
    }

    const hitCount = Number(ctx.bridge.data.hitCount ?? 0);
    const hasKnownHits = hitCount > 0;
    const turnNumber = Number(ctx.bridge.data.turnNumber ?? 0);
    const { coarseAsked, lateAsked } = countQuestionBuckets(ctx, this.lateGameTurn);
    const isLateGame = turnNumber >= this.lateGameTurn;

    const data = ctx.bridge.data;
    let bestQuestionValue = -Infinity;
    let bestQuestion: QuestionDescriptor | null = null;
    let bestSalvageScore: SalvageQuestionScore | null = null;

    if ((data.questionsRemaining as number) > 0) {
      const questions = !hasKnownHits
        ? selectCoarseQuestions(ctx.askedQuestions)
        : isLateGame
          ? selectSalvageQuestions(
              this.candidateQuestions,
              ctx.askedQuestions,
              () => ctx.rng.next(),
            )
          : [];
      const budgetAllowsQuestion = !hasKnownHits
        ? coarseAsked < this.coarseQuestionBudget
        : isLateGame && lateAsked < this.lateQuestionBudget;

      if (budgetAllowsQuestion) {
        for (const question of questions) {
          try {
            if (!hasKnownHits) {
              const detail = evaluateWorldQuestionDetailed(
                ctx.bridge,
                question,
                ctx.particles,
                ctx.epsilon,
              );
              const score = scoreCoarseQuestion(summary, question, detail.value, detail.pYes);
              if (score.adjustedValue > bestQuestionValue) {
                bestQuestionValue = score.adjustedValue;
                bestQuestion = question;
              }
              continue;
            }

            const detail = evaluateWorldQuestionDetailed(
              ctx.bridge,
              question,
              ctx.particles,
              ctx.epsilon,
            );
            const score = scoreSalvageQuestion(summary, question, detail.value, detail.pYes);
            if (score.adjustedValue > bestQuestionValue) {
              bestQuestionValue = score.adjustedValue;
              bestQuestion = question;
              bestSalvageScore = score;
            }
          } catch {
            // Skip broken evaluate/question combinations.
          }
        }
      }
    }

    await recordWorldSummary(ctx, summary, bestQuestion && hasKnownHits ? {
      id: bestQuestion.id,
      score: bestSalvageScore,
    } : null);

    if (bestQuestion && bestQuestionValue > bestShoot.boardValue) {
      ctx.askedQuestions.add(bestQuestion.id);
      return {
        action: "question",
        questionId: bestQuestion.id,
        questionText: bestQuestion.text,
        evaluate: bestQuestion.evaluate,
      };
    }

    return {
      action: "shoot",
      cellId: bestShoot.cellId,
      cellIndex: bestShoot.cellIndex,
    };
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

function selectCoarseQuestions(askedQuestions: Set<string>): QuestionDescriptor[] {
  return getTemplateQuestions()
    .filter((question) =>
      isCoarseQuestionFamily(question.family) &&
      !askedQuestions.has(question.id) &&
      !askedQuestions.has(question.text)
    );
}

function selectSalvageQuestions(
  _count: number,
  askedQuestions: Set<string>,
  _rngNext: () => number,
): QuestionDescriptor[] {
  return getTemplateQuestions().filter((question) => {
    const family = inferQuestionFamilyFromId(question.id);
    const allowed = isCoarseQuestionFamily(family) || family === "block-2x2";
    return allowed &&
      !askedQuestions.has(question.id) &&
      !askedQuestions.has(question.text);
  });
}

function countQuestionBuckets(
  ctx: TurnContext,
  lateGameTurn: number,
): { coarseAsked: number; lateAsked: number } {
  let coarseAsked = 0;
  let lateAsked = 0;

  for (const question of ctx.gameState.questions.values()) {
    const bucket = classifyQuestionBudgetBucket(question.id, question.turnAsked, lateGameTurn);
    if (bucket === "coarse") {
      coarseAsked++;
    } else if (bucket === "late") {
      lateAsked++;
    }
  }

  return { coarseAsked, lateAsked };
}
