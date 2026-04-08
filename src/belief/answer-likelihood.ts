const EPSILON_FLOOR = 1e-10;
const DEFAULT_EVIDENCE_SCALE = 0.8;

/**
 * Temper noisy question evidence slightly toward 0.5 so a single answer does
 * not over-collapse the posterior in the paper setting.
 */
export function answerLikelihood(
  matchesObservation: boolean,
  epsilon: number,
  evidenceScale: number = DEFAULT_EVIDENCE_SCALE,
): number {
  if (epsilon <= 0) {
    return matchesObservation ? 1 : EPSILON_FLOOR;
  }

  const boundedScale = Math.max(0, Math.min(1, evidenceScale));
  const mismatchProb = clampProbability(epsilon);
  const matchProb = clampProbability(1 - epsilon);
  const rawProbability = matchesObservation ? matchProb : mismatchProb;
  const temperedProbability = 0.5 + ((rawProbability - 0.5) * boundedScale);

  return clampProbability(temperedProbability);
}

function clampProbability(value: number): number {
  return Math.max(EPSILON_FLOOR, Math.min(1 - EPSILON_FLOOR, value));
}

