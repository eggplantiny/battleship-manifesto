/**
 * Common game execution: shot and question resolution.
 * Uses bridge.dispatch() — no hardcoded action names except game fundamentals.
 */
import type { ManifestoBridge } from "./bridge.js";
import type { Board } from "../domain/types.js";
import { cellIdToIndex } from "../domain/types.js";
import type { GameState } from "../domain/game-state.js";
import type { BeliefState } from "../belief/belief-state.js";
import { noisySpotter, oracleSpotter } from "../belief/spotter.js";

export interface ShotResult {
  cellId: string;
  isHit: boolean;
}

export interface QuestionResult {
  id: string;
  text: string;
  answer: boolean;
}

export async function executeShot(
  bridge: ManifestoBridge,
  gameState: GameState,
  particles: BeliefState,
  cellId: string,
): Promise<ShotResult> {
  await bridge.dispatch("shoot", cellId);
  const result = await resolveShot(bridge, gameState, cellId);

  if (gameState.allShipsSunk()) {
    await bridge.dispatch("endGame", "won");
  }

  particles.observeShot(cellIdToIndex(cellId), result.isHit);
  return result;
}

export async function executeWorldShot(
  bridge: ManifestoBridge,
  gameState: GameState,
  particles: BeliefState,
  cellId: string,
): Promise<ShotResult> {
  if (!bridge.isIntentDispatchable("shoot", cellId)) {
    const blockers = bridge.getIntentBlockers("shoot", cellId);
    throw new Error(`World shot is not dispatchable at ${cellId}: ${JSON.stringify(blockers)}`);
  }

  await bridge.dispatch("shoot", cellId);
  const result = await resolveShot(bridge, gameState, cellId);

  if (gameState.allShipsSunk()) {
    await bridge.dispatch("endGame", "won");
  }

  particles.observeShot(cellIdToIndex(cellId), result.isHit);
  return result;
}

export async function executeQuestion(
  bridge: ManifestoBridge,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  questionId: string,
  questionText: string,
  evaluate: (board: Board) => boolean,
  epsilon: number = 0,
  spotterNext: () => number = () => 0,
): Promise<QuestionResult> {
  await bridge.dispatch("askQuestion", questionId, questionText);
  gameState.addQuestion(questionId, questionText, (bridge.data.turnNumber as number) ?? 0);
  const answer = epsilon > 0
    ? noisySpotter(evaluate, trueBoard, epsilon, spotterNext)
    : oracleSpotter(evaluate, trueBoard);
  gameState.answerQuestion(questionId, answer);
  particles.observeAnswer(evaluate, answer, epsilon);
  return { id: questionId, text: questionText, answer };
}

async function resolveShot(
  bridge: ManifestoBridge,
  gameState: GameState,
  cellId: string,
): Promise<ShotResult> {
  const cell = gameState.getCell(cellId);
  const isHit = cell?.hasShip ?? false;
  if (cell) {
    cell.status = isHit ? "hit" : "miss";
  }

  if (isHit) {
    await bridge.dispatch("recordHit", cellId);
    if (cell?.shipId) {
      const ship = gameState.ships.get(cell.shipId);
      if (ship) {
        ship.hitCount++;
        if (ship.hitCount >= ship.size) {
          ship.sunk = true;
        }
      }
    }
  } else {
    await bridge.dispatch("recordMiss", cellId);
  }

  return { cellId, isHit };
}
