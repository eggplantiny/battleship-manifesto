/**
 * Simulation evaluation: compute expected value of actions via sim.next().
 *
 * Shared by all agents. No agent-specific logic here.
 */
import type { ManifestoBridge } from "./bridge.js";
import type { BeliefState } from "../belief-state.js";
import type { QuestionDescriptor } from "../questions/template-questions.js";
import { BOARD_SIZE, indexToCellId, TOTAL_CELLS } from "../../domain/types.js";
import { answerLikelihood } from "../answer-likelihood.js";

export interface SimResult {
  cell: string;
  cellIndex: number;
  hitProb: number;
  boardValue: number;
}

/** P(hit) for a cell from particle set */
export function computePHit(cellIndex: number, particles: BeliefState): number {
  let pHit = 0;
  for (const p of particles.samples) {
    if (p.board.cells[cellIndex].hasShip) pHit += p.weight;
  }
  return pHit;
}

/** Evaluate a single cell: sim.next(shoot → recordHit/Miss) → expected boardValue */
export function evaluateCell(
  bridge: ManifestoBridge,
  cellId: string,
  cellIndex: number,
  particles: BeliefState,
): SimResult {
  const pHit = computePHit(cellIndex, particles);
  const sim = bridge.createSimSession();

  try {
    const afterShoot = sim.next(bridge.mel.actions.shoot, cellId);
    const hitVal = (afterShoot.next(bridge.mel.actions.recordHit, cellId).snapshot.computed as any).boardValue as number;
    const missVal = (afterShoot.next(bridge.mel.actions.recordMiss, cellId).snapshot.computed as any).boardValue as number;
    return { cell: cellId, cellIndex, hitProb: pHit, boardValue: pHit * hitVal + (1 - pHit) * missVal };
  } catch {
    return { cell: cellId, cellIndex, hitProb: pHit, boardValue: pHit * 0.071 };
  }
}

/** Evaluate all unrevealed cells. Returns sorted by boardValue descending. */
export function evaluateAllCells(
  bridge: ManifestoBridge,
  particles: BeliefState,
  revealedCells: Set<number>,
): SimResult[] {
  const results: SimResult[] = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (revealedCells.has(i)) continue;
    results.push(evaluateCell(bridge, indexToCellId(i), i, particles));
  }
  results.sort((a, b) => b.boardValue - a.boardValue);
  return results;
}

/** Evaluate a question: 2-step (ask → best shot in reweighted particles) */
export function evaluateQuestion(
  bridge: ManifestoBridge,
  question: Pick<QuestionDescriptor, "text" | "evaluate"> & Partial<Pick<QuestionDescriptor, "id">>,
  particles: BeliefState,
  revealedCells: Set<number>,
  epsilon: number = 0,
): number {
  let pYes = 0;
  for (const p of particles.samples) {
    try {
      if (question.evaluate(p.board)) pYes += p.weight;
    } catch {
      // Skip invalid sample/question combinations.
    }
  }

  try {
    const sim = bridge.createSimSession();
    const questionId = question.id ?? question.text;
    const afterAsk = sim.next(bridge.mel.actions.askQuestion, questionId, question.text);

    const yesResult = bestShotAfterAnswer(question.evaluate, true, afterAsk, bridge, particles, revealedCells, epsilon);
    const noResult = bestShotAfterAnswer(question.evaluate, false, afterAsk, bridge, particles, revealedCells, epsilon);

    return pYes * yesResult + (1 - pYes) * noResult;
  } catch {
    return 0;
  }
}

export function evaluateExploitPlan(
  bridge: ManifestoBridge,
  firstShot: SimResult,
  particles: BeliefState,
  revealedCells: Set<number>,
): number {
  try {
    const sim = bridge.createSimSession();
    const afterFirstShoot = sim.next(bridge.mel.actions.shoot, firstShot.cell);
    const blocked = new Set(revealedCells);
    blocked.add(firstShot.cellIndex);

    const hitWeights = reweightForShot(firstShot.cellIndex, true, particles);
    const missWeights = reweightForShot(firstShot.cellIndex, false, particles);
    const hitBranch = evaluateBestFollowUpShot(
      bridge,
      afterFirstShoot.next(bridge.mel.actions.recordHit, firstShot.cell),
      particles,
      hitWeights,
      blocked,
    );
    const missBranch = evaluateBestFollowUpShot(
      bridge,
      afterFirstShoot.next(bridge.mel.actions.recordMiss, firstShot.cell),
      particles,
      missWeights,
      blocked,
    );

    return firstShot.hitProb * hitBranch + (1 - firstShot.hitProb) * missBranch;
  } catch {
    return firstShot.boardValue;
  }
}

export function evaluateCloseoutPlan(
  bridge: ManifestoBridge,
  firstShot: SimResult,
  particles: BeliefState,
  revealedCells: Set<number>,
): number {
  try {
    const sim = bridge.createSimSession();
    const afterFirstShoot = sim.next(bridge.mel.actions.shoot, firstShot.cell);
    const blocked = new Set(revealedCells);
    blocked.add(firstShot.cellIndex);

    const hitWeights = reweightForShot(firstShot.cellIndex, true, particles);
    const missWeights = reweightForShot(firstShot.cellIndex, false, particles);
    const hitBranch = evaluateBestFollowUpShot(
      bridge,
      afterFirstShoot.next(bridge.mel.actions.recordHit, firstShot.cell),
      particles,
      hitWeights,
      blocked,
      firstShot.cellIndex,
    );
    const missBranch = evaluateBestFollowUpShot(
      bridge,
      afterFirstShoot.next(bridge.mel.actions.recordMiss, firstShot.cell),
      particles,
      missWeights,
      blocked,
    );

    return firstShot.hitProb * hitBranch + (1 - firstShot.hitProb) * missBranch;
  } catch {
    return firstShot.boardValue;
  }
}

function bestShotAfterAnswer(
  evaluate: (board: any) => boolean,
  answer: boolean,
  simStep: any,
  bridge: ManifestoBridge,
  particles: BeliefState,
  revealedCells: Set<number>,
  epsilon: number,
): number {
  const weights: number[] = [];
  let totalWeight = 0;
  for (const p of particles.samples) {
    let agrees: boolean;
    try {
      agrees = evaluate(p.board) === answer;
    } catch {
      weights.push(0);
      continue;
    }
    const w = p.weight * answerLikelihood(agrees, epsilon);
    weights.push(w);
    totalWeight += w;
  }
  if (totalWeight <= 0) return (simStep.snapshot.computed as any).boardValue as number;

  let bestCell = "";
  let bestPHit = -1;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (revealedCells.has(i)) continue;
    let pHit = 0;
    for (let j = 0; j < particles.samples.length; j++) {
      if (particles.samples[j].board.cells[i].hasShip) pHit += weights[j] / totalWeight;
    }
    if (pHit > bestPHit) {
      bestPHit = pHit;
      bestCell = indexToCellId(i);
    }
  }

  if (!bestCell) return (simStep.snapshot.computed as any).boardValue as number;

  try {
    const afterShoot = simStep.next(bridge.mel.actions.shoot, bestCell);
    const hitVal = (afterShoot.next(bridge.mel.actions.recordHit, bestCell).snapshot.computed as any).boardValue as number;
    const missVal = (afterShoot.next(bridge.mel.actions.recordMiss, bestCell).snapshot.computed as any).boardValue as number;
    return bestPHit * hitVal + (1 - bestPHit) * missVal;
  } catch {
    return (simStep.snapshot.computed as any).boardValue as number;
  }
}

function reweightForShot(cellIndex: number, isHit: boolean, particles: BeliefState): number[] | null {
  const weights = particles.samples.map((sample) =>
    sample.board.cells[cellIndex].hasShip === isHit ? sample.weight : 0
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return null;
  }
  return weights.map((weight) => weight / total);
}

function evaluateBestFollowUpShot(
  bridge: ManifestoBridge,
  simStep: any,
  particles: BeliefState,
  weights: number[] | null,
  blockedCells: Set<number>,
  anchorCellIndex?: number,
): number {
  if (!weights) {
    return (simStep.snapshot.computed as any).boardValue as number;
  }

  const candidateIndices = anchorCellIndex === undefined
    ? getGlobalCandidateIndices(blockedCells)
    : getLocalCandidateIndices(anchorCellIndex, blockedCells);

  let bestValue = -1;
  for (const cellIndex of candidateIndices) {
    const cellId = indexToCellId(cellIndex);
    let pHit = 0;
    for (let sampleIndex = 0; sampleIndex < particles.samples.length; sampleIndex++) {
      if (particles.samples[sampleIndex].board.cells[cellIndex].hasShip) {
        pHit += weights[sampleIndex];
      }
    }

    try {
      const afterShoot = simStep.next(bridge.mel.actions.shoot, cellId);
      const hitVal = (afterShoot.next(bridge.mel.actions.recordHit, cellId).snapshot.computed as any).boardValue as number;
      const missVal = (afterShoot.next(bridge.mel.actions.recordMiss, cellId).snapshot.computed as any).boardValue as number;
      const expectedValue = pHit * hitVal + (1 - pHit) * missVal;
      if (expectedValue > bestValue) {
        bestValue = expectedValue;
      }
    } catch {
      // Ignore non-shootable candidates in the simulated branch.
    }
  }

  return bestValue >= 0 ? bestValue : (simStep.snapshot.computed as any).boardValue as number;
}

function getGlobalCandidateIndices(blockedCells: Set<number>): number[] {
  const indices: number[] = [];
  for (let index = 0; index < TOTAL_CELLS; index++) {
    if (!blockedCells.has(index)) {
      indices.push(index);
    }
  }
  return indices;
}

function getLocalCandidateIndices(anchorCellIndex: number, blockedCells: Set<number>): number[] {
  const anchorRow = Math.floor(anchorCellIndex / BOARD_SIZE);
  const anchorCol = anchorCellIndex % BOARD_SIZE;
  const indices: number[] = [];

  for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
    for (let colDelta = -1; colDelta <= 1; colDelta++) {
      if (rowDelta === 0 && colDelta === 0) continue;
      const row = anchorRow + rowDelta;
      const col = anchorCol + colDelta;
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) continue;
      const index = row * BOARD_SIZE + col;
      if (!blockedCells.has(index)) {
        indices.push(index);
      }
    }
  }

  return indices.length > 0 ? indices : getGlobalCandidateIndices(blockedCells);
}
