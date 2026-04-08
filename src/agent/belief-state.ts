import type { Board } from "../domain/types.js";

export interface BeliefSample {
  board: Board;
  weight: number;
}

export type BeliefKind = "smc" | "mcmc";

export interface BeliefState {
  readonly kind: BeliefKind;
  readonly samples: readonly BeliefSample[];
  readonly particles: readonly BeliefSample[];
  observeShot(cellIndex: number, isHit: boolean): void;
  observeAnswer(
    evaluate: (board: Board) => boolean,
    answer: boolean,
    epsilon?: number,
  ): void;
  getHitProbabilities(revealedCells: Set<number>): Map<number, number>;
  getESS(): number;
}

export interface MCMCConfig {
  burnIn?: number;
  thin?: number;
  proposalRetries?: number;
}

export interface CreateBeliefStateOptions {
  kind?: BeliefKind;
  sampleCount: number;
  seed: number;
  mcmc?: MCMCConfig;
}
