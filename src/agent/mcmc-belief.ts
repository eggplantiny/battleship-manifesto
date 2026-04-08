/**
 * MCMC posterior sampler over valid Battleship boards.
 *
 * Boards are sampled with a simple MH chain:
 * move one ship at a time while preserving global shot constraints, and
 * score proposals by question-answer likelihoods.
 */
import { generateBoard, SeededRandom } from "../board/generator.js";
import type { Board, Cell, Ship } from "../domain/types.js";
import { BOARD_SIZE } from "../domain/types.js";
import { answerLikelihood } from "./answer-likelihood.js";
import type { BeliefSample, BeliefState, MCMCConfig } from "./belief-state.js";

interface ShotObservation {
  type: "shot";
  cellIndex: number;
  isHit: boolean;
}

interface AnswerObservation {
  type: "answer";
  evaluate: (board: Board) => boolean;
  answer: boolean;
  epsilon: number;
}

type Observation = ShotObservation | AnswerObservation;

const DEFAULT_BURN_IN_FLOOR = 200;
const DEFAULT_THIN = 5;
const DEFAULT_PROPOSAL_RETRIES = 50;
const EPSILON_FLOOR = 1e-10;

export class MCMCBeliefState implements BeliefState {
  readonly kind = "mcmc" as const;
  private readonly rng: SeededRandom;
  private nextSeed: number;
  private readonly sampleCount: number;
  private readonly burnIn: number;
  private readonly thin: number;
  private readonly proposalRetries: number;
  private readonly observations: Observation[] = [];
  private sampleStore: BeliefSample[] = [];
  private currentBoard: Board;

  constructor(count: number, seed: number, config: MCMCConfig = {}) {
    this.rng = new SeededRandom(seed);
    this.nextSeed = seed + 20000;
    this.sampleCount = count;
    this.burnIn = config.burnIn ?? Math.max(DEFAULT_BURN_IN_FLOOR, count * 2);
    this.thin = config.thin ?? DEFAULT_THIN;
    this.proposalRetries = config.proposalRetries ?? DEFAULT_PROPOSAL_RETRIES;
    this.currentBoard = generateBoard(this.nextSeed++);
    this.refreshSamples();
  }

  get samples(): readonly BeliefSample[] {
    return this.sampleStore;
  }

  get particles(): readonly BeliefSample[] {
    return this.sampleStore;
  }

  observeShot(cellIndex: number, isHit: boolean): void {
    this.observations.push({ type: "shot", cellIndex, isHit });
    this.refreshSamples();
  }

  observeAnswer(
    evaluate: (board: Board) => boolean,
    answer: boolean,
    epsilon: number = 0,
  ): void {
    this.observations.push({ type: "answer", evaluate, answer, epsilon });
    this.refreshSamples();
  }

  getHitProbabilities(revealedCells: Set<number>): Map<number, number> {
    const probs = new Map<number, number>();

    for (let cellIndex = 0; cellIndex < BOARD_SIZE * BOARD_SIZE; cellIndex++) {
      if (revealedCells.has(cellIndex)) continue;

      let hitProb = 0;
      for (const sample of this.sampleStore) {
        if (sample.board.cells[cellIndex].hasShip) {
          hitProb += sample.weight;
        }
      }
      probs.set(cellIndex, hitProb);
    }

    return probs;
  }

  getESS(): number {
    let sumSq = 0;
    for (const sample of this.sampleStore) {
      sumSq += sample.weight * sample.weight;
    }
    return sumSq > 0 ? 1 / sumSq : 0;
  }

  private refreshSamples(): void {
    let current = this.ensureShotConsistentBoard(this.currentBoard);
    let currentLogPosterior = this.logPosterior(current);

    for (let step = 0; step < this.burnIn; step++) {
      [current, currentLogPosterior] = this.mcmcStep(current, currentLogPosterior);
    }

    const newSamples: BeliefSample[] = [];
    for (let index = 0; index < this.sampleCount; index++) {
      for (let step = 0; step < this.thin; step++) {
        [current, currentLogPosterior] = this.mcmcStep(current, currentLogPosterior);
      }
      newSamples.push({
        board: cloneBoard(current),
        weight: 1 / this.sampleCount,
      });
    }

    this.currentBoard = current;
    this.sampleStore = newSamples;
  }

  private mcmcStep(board: Board, currentLogPosterior: number): [Board, number] {
    const proposal = this.proposeBoard(board);
    if (!proposal) return [board, currentLogPosterior];

    const proposedLogPosterior = this.logPosterior(proposal);
    if (!Number.isFinite(proposedLogPosterior)) return [board, currentLogPosterior];

    if (!Number.isFinite(currentLogPosterior)) {
      return [proposal, proposedLogPosterior];
    }

    const logAcceptance = proposedLogPosterior - currentLogPosterior;
    if (logAcceptance >= 0 || Math.log(Math.max(this.rng.next(), Number.MIN_VALUE)) < logAcceptance) {
      return [proposal, proposedLogPosterior];
    }

    return [board, currentLogPosterior];
  }

  private proposeBoard(board: Board): Board | null {
    if (board.ships.length === 0) return null;

    const ship = board.ships[this.rng.nextInt(board.ships.length)];
    const placements = this.enumeratePlacements(board, ship);
    if (placements.length === 0) return null;

    const currentPlacementKey = placementKey(getShipIndices(board, ship.id));
    const alternativePlacements = placements.filter((placement) => placement.key !== currentPlacementKey);
    const pool = alternativePlacements.length > 0 ? alternativePlacements : placements;
    const selected = pool[this.rng.nextInt(pool.length)];

    return this.applyPlacement(board, ship, selected.indices);
  }

  private enumeratePlacements(
    board: Board,
    ship: Ship,
  ): Array<{ indices: number[]; key: string }> {
    const occupiedByOthers = new Array(BOARD_SIZE * BOARD_SIZE).fill(false);
    for (const cell of board.cells) {
      if (cell.shipId && cell.shipId !== ship.id) {
        occupiedByOthers[cell.index] = true;
      }
    }

    const placements: Array<{ indices: number[]; key: string }> = [];
    for (const horizontal of [true, false]) {
      const maxRow = horizontal ? BOARD_SIZE : BOARD_SIZE - ship.size + 1;
      const maxCol = horizontal ? BOARD_SIZE - ship.size + 1 : BOARD_SIZE;

      for (let row = 0; row < maxRow; row++) {
        for (let col = 0; col < maxCol; col++) {
          const indices: number[] = [];
          let valid = true;

          for (let offset = 0; offset < ship.size; offset++) {
            const targetRow = horizontal ? row : row + offset;
            const targetCol = horizontal ? col + offset : col;
            const index = targetRow * BOARD_SIZE + targetCol;
            if (occupiedByOthers[index]) {
              valid = false;
              break;
            }
            indices.push(index);
          }

          if (!valid) continue;
          if (!this.indicesRespectShotConstraints(indices, ship.id, board)) continue;

          placements.push({
            indices,
            key: placementKey(indices),
          });
        }
      }
    }

    return placements;
  }

  private indicesRespectShotConstraints(indices: number[], shipId: string, board: Board): boolean {
    const movedCells = new Set(indices);

    for (const observation of this.observations) {
      if (observation.type !== "shot") continue;

      const currentCell = board.cells[observation.cellIndex];
      const hasShip = currentCell.shipId === shipId
        ? movedCells.has(observation.cellIndex)
        : currentCell.hasShip;

      if (hasShip !== observation.isHit) {
        return false;
      }
    }

    return true;
  }

  private applyPlacement(board: Board, ship: Ship, indices: number[]): Board {
    const nextBoard = cloneBoard(board);

    for (const cell of nextBoard.cells) {
      if (cell.shipId === ship.id) {
        cell.shipId = null;
        cell.hasShip = false;
      }
    }

    for (const index of indices) {
      const cell = nextBoard.cells[index];
      cell.shipId = ship.id;
      cell.hasShip = true;
    }

    return nextBoard;
  }

  private ensureShotConsistentBoard(candidate: Board): Board {
    if (this.isShotConsistent(candidate)) {
      return candidate;
    }

    for (const sample of this.sampleStore) {
      if (this.isShotConsistent(sample.board)) {
        return cloneBoard(sample.board);
      }
    }

    const maxAttempts = Math.max(5000, this.sampleCount * 20);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const board = generateBoard(this.nextSeed++);
      if (this.isShotConsistent(board)) {
        return board;
      }
    }

    return cloneBoard(candidate);
  }

  private isShotConsistent(board: Board): boolean {
    for (const observation of this.observations) {
      if (observation.type !== "shot") continue;
      if (board.cells[observation.cellIndex].hasShip !== observation.isHit) {
        return false;
      }
    }
    return true;
  }

  private logPosterior(board: Board): number {
    if (!this.isShotConsistent(board)) {
      return Number.NEGATIVE_INFINITY;
    }

    let logProb = 0;
    for (const observation of this.observations) {
      if (observation.type !== "answer") continue;

      let trueAnswer = false;
      try {
        trueAnswer = observation.evaluate(board);
      } catch {
        trueAnswer = false;
      }

      const probability = answerLikelihood(trueAnswer === observation.answer, observation.epsilon);
      logProb += Math.log(Math.max(probability, EPSILON_FLOOR));
    }

    return logProb;
  }
}

function getShipIndices(board: Board, shipId: string): number[] {
  const indices = board.cells
    .filter((cell) => cell.shipId === shipId)
    .map((cell) => cell.index);
  indices.sort((left, right) => left - right);
  return indices;
}

function placementKey(indices: number[]): string {
  return indices.join(",");
}

function cloneBoard(board: Board): Board {
  return {
    cells: board.cells.map(cloneCell),
    ships: board.ships.map(cloneShip),
  };
}

function cloneCell(cell: Cell): Cell {
  return { ...cell };
}

function cloneShip(ship: Ship): Ship {
  return { ...ship };
}
