/**
 * SMC (Sequential Monte Carlo) Particle Set
 *
 * Maintains a weighted set of hypothetical boards consistent with observations.
 * Used for M_Bayes (hit probability) and Q_Bayes (EIG) computations.
 */
import { generateBoard, SeededRandom } from "../board/generator.js";
import type { Board } from "../domain/types.js";
import { BOARD_SIZE, TOTAL_CELLS } from "../domain/types.js";
import { answerLikelihood } from "./answer-likelihood.js";
import type { BeliefSample, BeliefState } from "./belief-state.js";

export interface Particle extends BeliefSample {}

export interface Observation {
  type: "shot";
  cellIndex: number;
  isHit: boolean;
}

export class ParticleSet implements BeliefState {
  readonly kind = "smc" as const;
  particles: Particle[];
  private observations: Observation[] = [];
  private rng: SeededRandom;
  private nextSeed: number;

  constructor(count: number, seed: number) {
    this.rng = new SeededRandom(seed);
    this.nextSeed = seed + 10000;
    this.particles = [];

    for (let i = 0; i < count; i++) {
      this.particles.push({
        board: generateBoard(this.nextSeed++),
        weight: 1 / count,
      });
    }
  }

  get samples(): readonly Particle[] {
    return this.particles;
  }

  /** Update weights after observing a shot result */
  observeShot(cellIndex: number, isHit: boolean): void {
    this.observations.push({ type: "shot", cellIndex, isHit });

    for (const p of this.particles) {
      const cell = p.board.cells[cellIndex];
      if (cell.hasShip !== isHit) {
        p.weight = 0;
      }
    }

    this.normalize();
    this.resampleIfNeeded();
  }

  /** Update weights after receiving an answer to a question (Eq.2) */
  observeAnswer(
    evaluate: (board: Board) => boolean,
    answer: boolean,
    epsilon: number = 0,
  ): void {
    for (const p of this.particles) {
      const trueAnswer = evaluate(p.board);
      p.weight *= answerLikelihood(trueAnswer === answer, epsilon);
    }

    this.normalize();
    this.resampleIfNeeded();
  }

  /** Compute hit probability for each unrevealed cell (M_Bayes) */
  getHitProbabilities(revealedCells: Set<number>): Map<number, number> {
    const probs = new Map<number, number>();

    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (revealedCells.has(i)) continue;

      let hitProb = 0;
      for (const p of this.particles) {
        if (p.board.cells[i].hasShip) {
          hitProb += p.weight;
        }
      }
      probs.set(i, hitProb);
    }

    return probs;
  }

  /** Effective Sample Size: 1 / Σ(w_i²) */
  getESS(): number {
    let sumSq = 0;
    for (const p of this.particles) {
      sumSq += p.weight * p.weight;
    }
    return sumSq > 0 ? 1 / sumSq : 0;
  }

  private normalize(): void {
    let sum = 0;
    for (const p of this.particles) {
      sum += p.weight;
    }

    if (sum <= 0) {
      // All particles eliminated — regenerate
      this.regenerate();
      return;
    }

    for (const p of this.particles) {
      p.weight /= sum;
    }
  }

  private resampleIfNeeded(): void {
    const ess = this.getESS();
    if (ess < this.particles.length / 2) {
      this.resample();
    }
  }

  /** Systematic resampling */
  private resample(): void {
    const n = this.particles.length;
    const cumWeights: number[] = [];
    let cumSum = 0;

    for (const p of this.particles) {
      cumSum += p.weight;
      cumWeights.push(cumSum);
    }

    const newParticles: Particle[] = [];
    const u0 = this.rng.next() / n;

    let j = 0;
    for (let i = 0; i < n; i++) {
      const u = u0 + i / n;
      while (j < n - 1 && cumWeights[j] < u) {
        j++;
      }
      // Clone the selected particle with a fresh board copy
      newParticles.push({
        board: cloneBoard(this.particles[j].board),
        weight: 1 / n,
      });
    }

    this.particles = newParticles;
  }

  /** Regenerate all particles consistent with observations */
  private regenerate(): void {
    const n = this.particles.length;
    const newParticles: Particle[] = [];
    let attempts = 0;
    const maxAttempts = n * 100;

    while (newParticles.length < n && attempts < maxAttempts) {
      attempts++;
      const board = generateBoard(this.nextSeed++);

      if (this.isConsistent(board)) {
        newParticles.push({ board, weight: 1 / n });
      }
    }

    if (newParticles.length < n) {
      // Fill remaining with last valid or random (degraded state)
      const filler = newParticles.length > 0
        ? newParticles[newParticles.length - 1]
        : { board: generateBoard(this.nextSeed++), weight: 1 / n };
      while (newParticles.length < n) {
        newParticles.push({ board: cloneBoard(filler.board), weight: 1 / n });
      }
    }

    this.particles = newParticles;
  }

  /** Check if a board is consistent with all shot observations */
  private isConsistent(board: Board): boolean {
    for (const obs of this.observations) {
      const cell = board.cells[obs.cellIndex];
      if (cell.hasShip !== obs.isHit) return false;
    }
    return true;
  }
}

function cloneBoard(board: Board): Board {
  return {
    cells: board.cells.map((c) => ({ ...c })),
    ships: board.ships.map((s) => ({ ...s })),
  };
}

export { ParticleSet as SMCBeliefState };
