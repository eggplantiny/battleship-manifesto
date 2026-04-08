/**
 * M Agent v3: Manifesto-native Captain on MEL v3 (per-cell actions).
 *
 * sim.next(shootXX) → recordHit/Miss(cellId) → snapshot.computed.boardValue
 * All evaluation through simulation. No heuristics in agent code.
 */
import { createSimulationSession } from "@manifesto-ai/sdk/extensions";
import type { Board } from "../domain/types.js";
import { indexToCellId, cellIdToIndex, TOTAL_CELLS, BOARD_SIZE } from "../domain/types.js";
import { GameState } from "../domain/game-state.js";
import type { BeliefState } from "./belief-state.js";
import { oracleSpotter } from "./spotter.js";
import { SeededRandom } from "../board/generator.js";
import { OllamaClient } from "./legacy-llm/ollama.js";
import { selectTemplateQuestions } from "./questions/template-questions.js";
import type { ParsedQuestion } from "./legacy-llm/parse-response.js";
import { answerLikelihood } from "./answer-likelihood.js";

export interface MAgentConfig {
  particleCount: number;
  epsilon: number;
  ollamaModel: string;
  useLLM: boolean;
  candidateQuestions: number;
  topK: number;
}

export const DEFAULT_M_CONFIG: MAgentConfig = {
  particleCount: 200,
  epsilon: 0,
  ollamaModel: "gemma3:4b-it-qat",
  useLLM: false,
  candidateQuestions: 10,
  topK: 5,
};

interface ActionCandidate {
  type: "shoot" | "ask";
  cellIndex?: number;
  cellId?: string;
  question?: ParsedQuestion;
  expectedValue: number;
}

function readValue(snapshot: any): number {
  return (snapshot.computed as any).boardValue as number;
}

/** 1-step shoot evaluation via sim.next() */
function evaluateShoot(
  cellId: string,
  cellIndex: number,
  runtime: any,
  sim: any,
  particles: BeliefState,
): number {
  try {
    const afterShoot = sim.next(runtime.MEL.actions.shoot, cellId);
    const hitVal = readValue(afterShoot.next(runtime.MEL.actions.recordHit, cellId).snapshot);
    const missVal = readValue(afterShoot.next(runtime.MEL.actions.recordMiss, cellId).snapshot);

    let pHit = 0;
    for (const p of particles.particles) {
      if (p.board.cells[cellIndex].hasShip) pHit += p.weight;
    }

    return pHit * hitVal + (1 - pHit) * missVal;
  } catch {
    return 0;
  }
}

/** Evaluate question via 2-step: ask → best shot */
function evaluateQuestion(
  question: ParsedQuestion,
  runtime: any,
  sim: any,
  particles: BeliefState,
  revealedCells: Set<number>,
  epsilon: number,
): number {
  let pYes = 0;
  for (const p of particles.particles) {
    try { if (question.evaluate(p.board)) pYes += p.weight; } catch { /* skip */ }
  }

  try {
    const afterAsk = sim.next(runtime.MEL.actions.askQuestion, getQuestionId(question), question.text);

    const yesVal = bestShotAfterAnswer(question, true, afterAsk, runtime, particles, revealedCells, epsilon);
    const noVal = bestShotAfterAnswer(question, false, afterAsk, runtime, particles, revealedCells, epsilon);

    return pYes * yesVal + (1 - pYes) * noVal;
  } catch {
    return 0;
  }
}

function bestShotAfterAnswer(
  question: ParsedQuestion,
  answer: boolean,
  simStep: any,
  runtime: any,
  particles: BeliefState,
  revealedCells: Set<number>,
  epsilon: number,
): number {
  // Reweight particles
  const weights: number[] = [];
  let totalWeight = 0;
  for (const p of particles.particles) {
    let agrees: boolean;
    try { agrees = question.evaluate(p.board) === answer; } catch { weights.push(0); continue; }
    const w = p.weight * answerLikelihood(agrees, epsilon);
    weights.push(w);
    totalWeight += w;
  }
  if (totalWeight <= 0) return readValue(simStep.snapshot);

  // Find best cell + its P(hit) in reweighted set
  let bestCell = "";
  let bestPHit = -1;
  for (let cellIndex = 0; cellIndex < TOTAL_CELLS; cellIndex++) {
    if (revealedCells.has(cellIndex)) continue;
    const cellId = indexToCellId(cellIndex);
    let pHit = 0;
    for (let j = 0; j < particles.particles.length; j++) {
      if (particles.particles[j].board.cells[cellIndex].hasShip) {
        pHit += weights[j] / totalWeight;
      }
    }
    if (pHit > bestPHit) { bestPHit = pHit; bestCell = cellId; }
  }

  if (!bestCell) return readValue(simStep.snapshot);

  try {
    const afterShoot = simStep.next(runtime.MEL.actions.shoot, bestCell);
    const hitVal = readValue(afterShoot.next(runtime.MEL.actions.recordHit, bestCell).snapshot);
    const missVal = readValue(afterShoot.next(runtime.MEL.actions.recordMiss, bestCell).snapshot);
    return bestPHit * hitVal + (1 - bestPHit) * missVal;
  } catch {
    return readValue(simStep.snapshot);
  }
}

/**
 * M Agent turn on MEL v3.
 */
export async function mAgentTurn(
  runtime: any,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  config: MAgentConfig,
  rng: SeededRandom,
  askedQuestions: Set<string>,
  ollama: OllamaClient | null,
): Promise<{ action: "shoot" | "question"; cellId?: string; questionText?: string; questionAnswer?: boolean; expectedValue: number }> {
  const revealedCells = gameState.getRevealedCellIndices();
  const sim = createSimulationSession(runtime);
  const candidates: ActionCandidate[] = [];

  // --- Shoot candidates (brute-force via sim.next()) ---
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (revealedCells.has(i)) continue;
    const cellId = indexToCellId(i);
    const value = evaluateShoot(cellId, i, runtime, sim, particles);
    candidates.push({ type: "shoot", cellIndex: i, cellId, expectedValue: value });
  }

  // --- Question candidates ---
  const snap = runtime.getSnapshot();
  const data = snap.data as any;
  if (data.questionsRemaining > 0) {
    const questions = selectTemplateQuestions(
      config.candidateQuestions, askedQuestions, () => rng.next(),
    );

    for (const q of questions) {
      try {
        const value = evaluateQuestion(q, runtime, sim, particles, revealedCells, config.epsilon);
        candidates.push({ type: "ask", question: q, expectedValue: value });
      } catch { /* skip */ }
    }
  }

  // --- Pick best ---
  candidates.sort((a, b) => b.expectedValue - a.expectedValue);
  const best = candidates[0];

  // --- Execute ---
  if (best.type === "shoot") {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, best.cellId!));

    const cell = gameState.getCell(best.cellId!);
    const isHit = cell?.hasShip ?? false;
    if (cell) cell.status = isHit ? "hit" : "miss";

    if (isHit) {
      await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, best.cellId!));
      if (cell?.shipId) {
        const ship = gameState.ships.get(cell.shipId);
        if (ship) { ship.hitCount++; if (ship.hitCount >= ship.size) ship.sunk = true; }
      }
    } else {
      await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, best.cellId!));
    }

    if (gameState.allShipsSunk()) {
      await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.endGame, "won"));
    }

    particles.observeShot(best.cellIndex!, isHit);
    return { action: "shoot", cellId: best.cellId!, expectedValue: best.expectedValue };
  } else {
    const q = best.question!;
    askedQuestions.add(getQuestionId(q));
    await runtime.dispatchAsync(
      runtime.createIntent(runtime.MEL.actions.askQuestion, getQuestionId(q), q.text),
    );
    const answer = oracleSpotter(q.evaluate, trueBoard);
    particles.observeAnswer(q.evaluate, answer, config.epsilon);
    return { action: "question", questionText: q.text, questionAnswer: answer, expectedValue: best.expectedValue };
  }
}

function getQuestionId(question: ParsedQuestion): string {
  return typeof question.id === "string" && question.id.length > 0
    ? question.id
    : question.text;
}
