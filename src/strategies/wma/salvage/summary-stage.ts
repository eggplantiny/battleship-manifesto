import { evaluateAllWorldCells } from "../../../runtime/simulation-world.js";
import { computeWorldBeliefSummary } from "../../../runtime/world-belief-summary.js";
import { classifyQuestionBudgetBucket } from "../../../questions/template-questions.js";
import type { ExperimentPipelineStage } from "../../../pipeline/experiment-pipeline.js";
import type { TurnContext } from "../../strategy.js";
import type { SalvageSummaryState } from "./types.js";

export function createSalvageSummaryStage(
  lateGameTurn: number,
): ExperimentPipelineStage<TurnContext, SalvageSummaryState> {
  return {
    name: "wma_salvage_summary",
    async run(ctx) {
      const shootResults = evaluateAllWorldCells(ctx.bridge, ctx.particles);
      if (shootResults.length === 0) {
        throw new Error("WMA-LLM found no dispatchable shoot candidates");
      }

      const bestShoot = shootResults[0]!;
      const summary = computeWorldBeliefSummary(ctx.bridge, ctx.particles, bestShoot.hitProb);
      const data = ctx.bridge.data as Record<string, unknown>;
      const hitCount = Number(data.hitCount ?? 0);
      const turnNumber = Number(data.turnNumber ?? 0);
      const { coarseAsked, lateAsked } = countQuestionBuckets(ctx, lateGameTurn);
      const output: SalvageSummaryState = {
        ctx,
        shootResults,
        bestShoot,
        summary,
        frontierCellIds: summary.frontierCellIds,
        data,
        hasKnownHits: hitCount > 0,
        turnNumber,
        isLateGame: turnNumber >= lateGameTurn,
        coarseAsked,
        lateAsked,
      };

      return {
        value: output,
        status: "success",
        metadata: {
          bestShootCell: bestShoot.cellId,
          bestShootHitProb: bestShoot.hitProb,
          frontierCount: summary.frontierCount,
          largestHitClusterSize: summary.largestHitClusterSize,
          hasKnownHits: output.hasKnownHits,
          coarseAsked,
          lateAsked,
        },
      };
    },
  };
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
