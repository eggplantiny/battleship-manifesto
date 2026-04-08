/**
 * Simulation computation for MP Agent.
 * Given a cell, compute P(hit) from particles and expected boardValue via sim.next().
 */
import { createSimulationSession } from "@manifesto-ai/sdk/extensions";
import { indexToCellId, BOARD_SIZE } from "../domain/types.js";
import type { BeliefState } from "./belief-state.js";

export interface SimResult {
  cell: string;
  cellIndex: number;
  hitProb: number;
  boardValue: number;
}

export function computeSimulation(
  runtime: any,
  cellId: string,
  cellIndex: number,
  particles: BeliefState,
): SimResult {
  const row = Math.floor(cellIndex / BOARD_SIZE);
  const col = cellIndex % BOARD_SIZE;

  // P(hit) from particles
  let pHit = 0;
  for (const p of particles.samples) {
    if (p.board.cells[cellIndex].hasShip) pHit += p.weight;
  }

  // sim.next() for boardValue
  const sim = createSimulationSession(runtime);
  const afterShoot = sim.next(runtime.MEL.actions.shoot, cellId);
  const hitSnapshot = afterShoot.next(runtime.MEL.actions.recordHit, row, col).snapshot;
  const missSnapshot = afterShoot.next(runtime.MEL.actions.recordMiss, row, col).snapshot;

  const hitValue = (hitSnapshot.computed as any).boardValue as number;
  const missValue = (missSnapshot.computed as any).boardValue as number;
  const expectedValue = pHit * hitValue + (1 - pHit) * missValue;

  return { cell: cellId, cellIndex, hitProb: pHit, boardValue: expectedValue };
}
