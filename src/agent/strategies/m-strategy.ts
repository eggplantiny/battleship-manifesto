/**
 * M Strategy: brute-force evaluation via sim.next().
 *
 * Evaluates all unrevealed cells + template questions.
 * Picks the action with highest expected boardValue.
 * No LLM. No planning state.
 */
import type { Strategy, TurnContext, TurnDecision } from "./strategy.js";
import { evaluateAllCells, evaluateQuestion } from "../core/simulation.js";
import { selectTemplateQuestions, type QuestionDescriptor } from "../questions/template-questions.js";

export class MStrategy implements Strategy {
  name = "m";

  constructor(private candidateQuestions: number = 10) {}

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const revealedCells = ctx.gameState.getRevealedCellIndices();

    // Evaluate all shoot candidates
    const shootResults = evaluateAllCells(ctx.bridge, ctx.particles, revealedCells);

    // Evaluate question candidates
    const data = ctx.bridge.data;
    let bestQuestionValue = -Infinity;
    let bestQuestion: QuestionDescriptor | null = null;

    if ((data.questionsRemaining as number) > 0) {
      const questions = selectTemplateQuestions(
        this.candidateQuestions, ctx.askedQuestions, () => ctx.rng.next(),
      );
      for (const q of questions) {
        try {
          const value = evaluateQuestion(ctx.bridge, q, ctx.particles, revealedCells, ctx.epsilon);
          if (value > bestQuestionValue) {
            bestQuestionValue = value;
            bestQuestion = q;
          }
        } catch { /* skip broken evaluate */ }
      }
    }

    // Pick best overall
    const bestShoot = shootResults[0];
    if (bestQuestion && bestQuestionValue > bestShoot.boardValue) {
      ctx.askedQuestions.add(bestQuestion.id);
      return {
        action: "question",
        questionId: bestQuestion.id,
        questionText: bestQuestion.text,
        evaluate: bestQuestion.evaluate,
      };
    }

    return { action: "shoot", cellId: bestShoot.cell };
  }
}
