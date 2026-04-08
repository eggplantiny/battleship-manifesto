/**
 * Bayesian strategies from Grand et al. (2025)
 *
 * M_Bayes: select best cell to shoot (argmax hit probability)
 * Q_Bayes: compute EIG for candidate questions
 * D_Bayes: decide explore (question) vs exploit (shot)
 */
import type { Board } from "../domain/types.js";
import { answerLikelihood } from "./answer-likelihood.js";
import type { BeliefSample } from "./belief-state.js";

/** Binary entropy H_b(x) = -x·log₂(x) - (1-x)·log₂(1-x) */
function binaryEntropy(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  return -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);
}

/** M_Bayes: select cell index with highest hit probability */
export function selectBestShot(hitProbs: Map<number, number>): number {
  let bestCell = -1;
  let bestProb = -1;

  for (const [cell, prob] of hitProbs) {
    if (prob > bestProb) {
      bestProb = prob;
      bestCell = cell;
    }
  }

  return bestCell;
}

/** Get the maximum hit probability */
export function maxHitProb(hitProbs: Map<number, number>): number {
  let best = 0;
  for (const prob of hitProbs.values()) {
    if (prob > best) best = prob;
  }
  return best;
}

/**
 * Q_Bayes: Compute Expected Information Gain for a question (Eq.4)
 *
 * EIG_ε(q) = H_b(ε + (1-2ε)·p_t) - H_b(ε)
 *
 * where p_t = weighted fraction of particles where evaluate returns true
 */
export function computeEIG(
  evaluate: (board: Board) => boolean,
  particles: readonly BeliefSample[],
  epsilon: number = 0,
): number {
  // p_t: probability of "yes" under current belief
  let pYes = 0;
  for (const p of particles) {
    try {
      if (evaluate(p.board)) {
        pYes += p.weight;
      }
    } catch {
      // evaluate failed on this board — treat as "no"
    }
  }

  // Closed-form EIG
  const eig = binaryEntropy(epsilon + (1 - 2 * epsilon) * pYes) - binaryEntropy(epsilon);
  return eig;
}

export interface ScoredQuestion {
  id?: string;
  family?: string;
  text: string;
  evaluate: (board: Board) => boolean;
  eig: number;
}

/**
 * D_Bayes: Should we ask a question or shoot? (Section 3.1)
 *
 * Ask if: γ · post-question best hit prob > current best hit prob
 *
 * Post-question hit prob is the expected best hit prob after receiving
 * the answer to the question.
 */
export function shouldAskQuestion(
  bestQuestion: ScoredQuestion,
  hitProbs: Map<number, number>,
  particles: readonly BeliefSample[],
  gamma: number = 0.95,
  epsilon: number = 0,
): boolean {
  const currentBestHitProb = maxHitProb(hitProbs);

  // p_t: prob of "yes"
  let pYes = 0;
  for (const p of particles) {
    try {
      if (bestQuestion.evaluate(p.board)) {
        pYes += p.weight;
      }
    } catch { /* skip */ }
  }

  // Simulate "yes" and "no" outcomes
  const postYesHitProb = computePostHitProb(bestQuestion.evaluate, particles, true, epsilon);
  const postNoHitProb = computePostHitProb(bestQuestion.evaluate, particles, false, epsilon);

  // Expected post-question hit prob (Eq.7 simplified)
  const pNoisy = epsilon + (1 - 2 * epsilon) * pYes;
  const expectedPostHitProb = pNoisy * postYesHitProb + (1 - pNoisy) * postNoHitProb;

  return gamma * expectedPostHitProb > currentBestHitProb;
}

/**
 * Compute the best hit probability after observing an answer.
 * Simulates Bayesian belief update and finds the max hit prob cell.
 */
function computePostHitProb(
  evaluate: (board: Board) => boolean,
  particles: readonly BeliefSample[],
  answer: boolean,
  epsilon: number,
): number {
  // Reweight particles based on hypothetical answer
  const reweighted: { board: Board; weight: number }[] = [];
  let totalWeight = 0;

  for (const p of particles) {
    let trueAnswer: boolean;
    try {
      trueAnswer = evaluate(p.board);
    } catch {
      continue; // skip broken evaluations
    }
    const newWeight = p.weight * answerLikelihood(trueAnswer === answer, epsilon);
    reweighted.push({ board: p.board, weight: newWeight });
    totalWeight += newWeight;
  }

  if (totalWeight <= 0) return 0;

  // Normalize and find best hit prob
  let bestHitProb = 0;
  for (let i = 0; i < 64; i++) {
    let cellHitProb = 0;
    for (const p of reweighted) {
      if (p.board.cells[i].hasShip) {
        cellHitProb += p.weight / totalWeight;
      }
    }
    if (cellHitProb > bestHitProb) {
      bestHitProb = cellHitProb;
    }
  }

  return bestHitProb;
}
