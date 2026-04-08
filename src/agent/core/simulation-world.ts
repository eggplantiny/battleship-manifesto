import type { ManifestoBridge } from "./bridge.js";
import type { BeliefState } from "../belief-state.js";
import type { QuestionDescriptor } from "../questions/template-questions.js";
import { TOTAL_CELLS, indexToCellId } from "../../domain/types.js";
import { answerLikelihood } from "../answer-likelihood.js";
import { readWorldCells } from "./world-frontier.js";

export interface WorldSimResult {
  cellId: string;
  cellIndex: number;
  hitProb: number;
  boardValue: number;
}

export interface WorldQuestionEvalResult {
  value: number;
  pYes: number;
  splitQuality: number;
}

export function computeWorldPHit(cellIndex: number, particles: BeliefState): number {
  let pHit = 0;
  for (const sample of particles.samples) {
    if (sample.board.cells[cellIndex].hasShip) {
      pHit += sample.weight;
    }
  }
  return pHit;
}

export function evaluateWorldCell(
  bridge: ManifestoBridge,
  cellIndex: number,
  particles: BeliefState,
): WorldSimResult {
  const cellId = indexToCellId(cellIndex);
  const pHit = computeWorldPHit(cellIndex, particles);
  const sim = bridge.createSimSession();

  try {
    const afterShoot = sim.next(bridge.mel.actions.shoot, cellId);
    const hitVal = (afterShoot.next(bridge.mel.actions.recordHit, cellId).snapshot.computed as any).boardValue as number;
    const missVal = (afterShoot.next(bridge.mel.actions.recordMiss, cellId).snapshot.computed as any).boardValue as number;
    return { cellId, cellIndex, hitProb: pHit, boardValue: pHit * hitVal + (1 - pHit) * missVal };
  } catch {
    return { cellId, cellIndex, hitProb: pHit, boardValue: pHit * 0.071 };
  }
}

export function evaluateAllWorldCells(
  bridge: ManifestoBridge,
  particles: BeliefState,
): WorldSimResult[] {
  const results: WorldSimResult[] = [];
  for (let cellIndex = 0; cellIndex < TOTAL_CELLS; cellIndex++) {
    const cellId = indexToCellId(cellIndex);
    if (!bridge.isIntentDispatchable("shoot", cellId)) {
      continue;
    }
    results.push(evaluateWorldCell(bridge, cellIndex, particles));
  }
  results.sort((a, b) => b.boardValue - a.boardValue);
  return results;
}

export function evaluateWorldQuestion(
  bridge: ManifestoBridge,
  question: Pick<QuestionDescriptor, "text" | "evaluate"> & Partial<Pick<QuestionDescriptor, "id">>,
  particles: BeliefState,
  epsilon: number = 0,
): number {
  return evaluateWorldQuestionDetailed(bridge, question, particles, epsilon).value;
}

export function evaluateWorldQuestionDetailed(
  bridge: ManifestoBridge,
  question: Pick<QuestionDescriptor, "text" | "evaluate"> & Partial<Pick<QuestionDescriptor, "id">>,
  particles: BeliefState,
  epsilon: number = 0,
): WorldQuestionEvalResult {
  const blockedCellIds = getBlockedCellIds(bridge);
  let pYes = 0;
  for (const sample of particles.samples) {
    try {
      if (question.evaluate(sample.board)) {
        pYes += sample.weight;
      }
    } catch {
      // Skip invalid sample/question combinations.
    }
  }

  try {
    const sim = bridge.createSimSession();
    const questionId = question.id ?? question.text;
    const afterAsk = sim.next(bridge.mel.actions.askQuestion, questionId, question.text);
    const yesValue = bestWorldShotAfterAnswer(question.evaluate, true, afterAsk, bridge, particles, blockedCellIds, epsilon);
    const noValue = bestWorldShotAfterAnswer(question.evaluate, false, afterAsk, bridge, particles, blockedCellIds, epsilon);
    return {
      value: pYes * yesValue + (1 - pYes) * noValue,
      pYes,
      splitQuality: 1 - Math.abs((2 * pYes) - 1),
    };
  } catch {
    return {
      value: 0,
      pYes,
      splitQuality: 1 - Math.abs((2 * pYes) - 1),
    };
  }
}

function bestWorldShotAfterAnswer(
  evaluate: (board: any) => boolean,
  answer: boolean,
  simStep: any,
  bridge: ManifestoBridge,
  particles: BeliefState,
  blockedCellIds: Set<string>,
  epsilon: number,
): number {
  const weights: number[] = [];
  let totalWeight = 0;

  for (const sample of particles.samples) {
    let agrees: boolean;
    try {
      agrees = evaluate(sample.board) === answer;
    } catch {
      weights.push(0);
      continue;
    }

    const weight = sample.weight * answerLikelihood(agrees, epsilon);
    weights.push(weight);
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return (simStep.snapshot.computed as any).boardValue as number;
  }

  let bestCellIndex = -1;
  let bestPHit = -1;
  for (let cellIndex = 0; cellIndex < TOTAL_CELLS; cellIndex++) {
    const cellId = indexToCellId(cellIndex);
    if (blockedCellIds.has(cellId)) {
      continue;
    }
    let pHit = 0;
    for (let sampleIndex = 0; sampleIndex < particles.samples.length; sampleIndex++) {
      if (particles.samples[sampleIndex].board.cells[cellIndex].hasShip) {
        pHit += weights[sampleIndex] / totalWeight;
      }
    }
    if (pHit > bestPHit) {
      bestPHit = pHit;
      bestCellIndex = cellIndex;
    }
  }

  if (bestCellIndex < 0) {
    return (simStep.snapshot.computed as any).boardValue as number;
  }

  try {
    const cellId = indexToCellId(bestCellIndex);
    const afterShoot = simStep.next(bridge.mel.actions.shoot, cellId);
    const hitVal = (afterShoot.next(bridge.mel.actions.recordHit, cellId).snapshot.computed as any).boardValue as number;
    const missVal = (afterShoot.next(bridge.mel.actions.recordMiss, cellId).snapshot.computed as any).boardValue as number;
    return bestPHit * hitVal + (1 - bestPHit) * missVal;
  } catch {
    return (simStep.snapshot.computed as any).boardValue as number;
  }
}

function getBlockedCellIds(bridge: ManifestoBridge): Set<string> {
  const blocked = new Set<string>();
  for (const cell of readWorldCells(bridge)) {
    if (cell.status !== "unknown") {
      blocked.add(cell.id);
    }
  }
  return blocked;
}
