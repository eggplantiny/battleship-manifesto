/**
 * Spotter: answers yes/no to Captain's questions.
 * Oracle mode (ε=0): always gives the correct answer.
 */
import type { Board } from "../domain/types.js";

export type QuestionEvaluator = (board: Board) => boolean;

/** Oracle Spotter: always correct */
export function oracleSpotter(
  evaluate: QuestionEvaluator,
  trueBoard: Board,
): boolean {
  return evaluate(trueBoard);
}

/** Noisy Spotter: flips answer with probability ε */
export function noisySpotter(
  evaluate: QuestionEvaluator,
  trueBoard: Board,
  epsilon: number,
  rng: () => number,
): boolean {
  const truth = evaluate(trueBoard);
  return rng() < epsilon ? !truth : truth;
}
