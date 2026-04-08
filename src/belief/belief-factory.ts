import type { BeliefState, CreateBeliefStateOptions } from "./belief-state.js";
import { MCMCBeliefState } from "./mcmc-belief.js";
import { ParticleSet } from "./particles.js";

export function createBeliefState(options: CreateBeliefStateOptions): BeliefState {
  const kind = options.kind ?? "smc";
  switch (kind) {
    case "mcmc":
      return new MCMCBeliefState(options.sampleCount, options.seed, options.mcmc);
    case "smc":
    default:
      return new ParticleSet(options.sampleCount, options.seed);
  }
}
