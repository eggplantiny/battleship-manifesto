/**
 * Captain Agent: orchestrates each turn of the Battleship game.
 *
 * Supports multiple strategies:
 * - random: random shots, no questions
 * - greedy: M_Bayes (best hit probability), no questions
 * - bayes: M_Bayes + Q_Bayes (EIG) + D_Bayes (explore/exploit)
 */
import type { Board } from "../domain/types.js";
import { indexToCellId, TOTAL_SHIP_CELLS } from "../domain/types.js";
import { GameState } from "../domain/game-state.js";
import { createBeliefState } from "./belief-factory.js";
import type { BeliefState, BeliefKind } from "./belief-state.js";
import { selectBestShot, computeEIG, shouldAskQuestion, type ScoredQuestion } from "./bayes.js";
import { selectTemplateQuestions } from "./questions/template-questions.js";
import { generateScoredQuestions, type QuestionGeneratorConfig, DEFAULT_QG_CONFIG } from "./questions/question-generator.js";
import { noisySpotter, oracleSpotter } from "./spotter.js";
import { SeededRandom } from "../board/generator.js";
import { OllamaClient } from "./legacy-llm/ollama.js";
import { mAgentTurn, type MAgentConfig, DEFAULT_M_CONFIG } from "./m-agent.js";
import { mpAgentTurn, DEFAULT_MP_CONFIG } from "./mp-agent.js";

export type AgentType = "random" | "greedy" | "bayes" | "bayes-llm" | "m" | "m-llm" | "mp";

export interface AgentConfig {
  type: AgentType;
  particleCount: number;
  beliefKind: BeliefKind;
  gamma: number;         // D_Bayes discount factor
  epsilon: number;       // Spotter noise rate
  candidateQuestions: number;  // K: how many questions to score
  ollamaModel: string;   // LLM model for bayes-llm
}

export const DEFAULT_CONFIG: AgentConfig = {
  type: "bayes",
  particleCount: 500,
  beliefKind: "smc",
  gamma: 0.95,
  epsilon: 0.1,
  candidateQuestions: 10,
  ollamaModel: "gemma3:4b-it-qat",
};

export interface TurnResult {
  action: "shoot" | "question";
  cellId?: string;
  questionText?: string;
  questionAnswer?: boolean;
  eig?: number;
  bestHitProb?: number;
}

export interface GameResult {
  boardId: string;
  seed: number;
  agentType: AgentType;
  turns: TurnResult[];
  shotsFired: number;
  questionsAsked: number;
  hitCount: number;
  missCount: number;
  totalShipCells: number;
  targetingF1: number;
  won: boolean;
}

/**
 * Play a full game of Battleship.
 */
export async function playGame(
  boardId: string,
  trueBoard: Board,
  runtime: any,
  gameState: GameState,
  config: AgentConfig,
  gameSeed: number,
): Promise<GameResult> {
  const rng = new SeededRandom(gameSeed);
  const particles = createBeliefState({
    kind: config.beliefKind,
    sampleCount: config.particleCount,
    seed: gameSeed,
  });
  const turns: TurnResult[] = [];
  const askedQuestions = new Set<string>();
  const spotterRng = new SeededRandom(gameSeed + 1_000_003);
  const needsLLM = config.type === "bayes-llm" || config.type === "m-llm" || config.type === "mp";
  const ollama = needsLLM ? new OllamaClient(config.ollamaModel) : null;

  // Setup
  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS)
  );

  // Game loop
  while (true) {
    const snap = runtime.getSnapshot();
    const data = snap.data as any;

    if (data.phase === "won" || data.phase === "lost" || data.shotsRemaining <= 0) {
      break;
    }

    // Check if all ships sunk (via gameState)
    if (gameState.allShipsSunk()) {
      await runtime.dispatchAsync(
        runtime.createIntent(runtime.MEL.actions.endGame, "won")
      );
      break;
    }

    let turnResult: TurnResult;

    if (config.type === "mp" && ollama) {
      const mpConfig = {
        ...DEFAULT_MP_CONFIG,
        particleCount: config.particleCount,
        epsilon: config.epsilon,
        ollamaModel: config.ollamaModel,
      };
      // @ts-ignore — chatHistory persists across turns
      if (!gameState._mpChatHistory) (gameState as any)._mpChatHistory = [];
      const result = await mpAgentTurn(
        runtime, gameState, trueBoard, particles, mpConfig, rng, askedQuestions, ollama,
        (gameState as any)._mpChatHistory,
      );
      (gameState as any)._mpChatHistory = result.chatHistory;
      turnResult = {
        action: result.action,
        cellId: result.cellId,
        questionText: result.questionText,
        questionAnswer: result.questionAnswer,
        bestHitProb: 0,
      };
    } else if (config.type === "m" || config.type === "m-llm") {
      const mConfig: MAgentConfig = {
        ...DEFAULT_M_CONFIG,
        particleCount: config.particleCount,
        epsilon: config.epsilon,
        ollamaModel: config.ollamaModel,
        useLLM: config.type === "m-llm",
        candidateQuestions: config.candidateQuestions,
      };
      const result = await mAgentTurn(
        runtime, gameState, trueBoard, particles, mConfig, rng, askedQuestions, ollama,
      );
      turnResult = {
        action: result.action === "shoot" ? "shoot" : "question",
        cellId: result.cellId,
        questionText: result.questionText,
        questionAnswer: result.questionAnswer,
        bestHitProb: result.expectedValue,
      };
    } else {
      turnResult = await executeTurn(
        runtime, gameState, trueBoard, particles, config, rng, spotterRng, askedQuestions, ollama,
      );
    }

    turns.push(turnResult);
  }

  const finalSnap = runtime.getSnapshot();
  const finalData = finalSnap.data as any;
  const computed = finalSnap.computed as any;

  return {
    boardId,
    seed: gameSeed,
    agentType: config.type,
    turns,
    shotsFired: finalData.shotsFired,
    questionsAsked: finalData.questionsAsked,
    hitCount: finalData.hitCount,
    missCount: finalData.missCount,
    totalShipCells: finalData.totalShipCells,
    targetingF1: computed.targetingF1 ?? 0,
    won: finalData.phase === "won",
  };
}

async function executeTurn(
  runtime: any,
  gameState: GameState,
  trueBoard: Board,
  particles: BeliefState,
  config: AgentConfig,
  rng: SeededRandom,
  spotterRng: SeededRandom,
  askedQuestions: Set<string>,
  ollama: OllamaClient | null,
): Promise<TurnResult> {
  const snap = runtime.getSnapshot();
  const data = snap.data as any;
  const revealedCells = gameState.getRevealedCellIndices();

  if (config.type === "random") {
    return executeRandomTurn(runtime, gameState, particles, rng, revealedCells);
  }

  // M_Bayes: compute hit probabilities
  const hitProbs = particles.getHitProbabilities(revealedCells);
  const bestCellIndex = selectBestShot(hitProbs);

  if (config.type === "greedy" || data.questionsRemaining <= 0) {
    return executeShot(runtime, gameState, particles, bestCellIndex, hitProbs);
  }

  // Q_Bayes: score candidate questions by EIG
  let scored: ScoredQuestion[];

  if (config.type === "bayes-llm" && ollama) {
    // Hybrid: LLM + templates
    scored = await generateScoredQuestions(
      gameState,
      data as Record<string, unknown>,
      snap.computed as Record<string, unknown>,
      particles.particles,
      askedQuestions,
      () => rng.next(),
      ollama,
      { totalCandidates: config.candidateQuestions, llmCandidates: 5, epsilon: config.epsilon, useLLM: true },
    );
  } else {
    // Templates only
    const candidates = selectTemplateQuestions(
      config.candidateQuestions,
      askedQuestions,
      () => rng.next(),
    );
    scored = candidates.map((q) => ({
      text: q.text,
      evaluate: q.evaluate,
      eig: computeEIG(q.evaluate, particles.particles, config.epsilon),
    }));
    scored.sort((a, b) => b.eig - a.eig);
  }

  if (scored.length === 0) {
    return executeShot(runtime, gameState, particles, bestCellIndex, hitProbs);
  }

  const bestQuestion = scored[0];

  // D_Bayes: explore vs exploit
  const shouldAsk = shouldAskQuestion(
    bestQuestion, hitProbs, particles.particles, config.gamma, config.epsilon,
  );

  if (shouldAsk) {
    return executeQuestion(
      runtime, trueBoard, particles, bestQuestion, config.epsilon, spotterRng, askedQuestions,
    );
  } else {
    return executeShot(runtime, gameState, particles, bestCellIndex, hitProbs);
  }
}

async function executeShot(
  runtime: any,
  gameState: GameState,
  particles: BeliefState,
  cellIndex: number,
  hitProbs: Map<number, number>,
): Promise<TurnResult> {
  const cellIdStr = indexToCellId(cellIndex);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, cellIdStr));

  // Resolve hit/miss from GameState (ground truth)
  const cell = gameState.getCell(cellIdStr);
  const isHit = cell?.hasShip ?? false;
  if (cell) cell.status = isHit ? "hit" : "miss";

  if (isHit) {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, cellIdStr));
    if (cell?.shipId) {
      const ship = gameState.ships.get(cell.shipId);
      if (ship) {
        ship.hitCount++;
        if (ship.hitCount >= ship.size) ship.sunk = true;
      }
    }
  } else {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, cellIdStr));
  }

  // Check win
  if (gameState.allShipsSunk()) {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.endGame, "won"));
  }

  // Update particles
  particles.observeShot(cellIndex, isHit);

  return {
    action: "shoot",
    cellId: cellIdStr,
    bestHitProb: hitProbs.get(cellIndex) ?? 0,
  };
}

async function executeQuestion(
  runtime: any,
  trueBoard: Board,
  particles: BeliefState,
  question: ScoredQuestion,
  epsilon: number,
  spotterRng: SeededRandom,
  askedQuestions: Set<string>,
): Promise<TurnResult> {
  const questionId = getQuestionId(question);
  askedQuestions.add(questionId);

  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.askQuestion, questionId, question.text)
  );

  // Oracle spotter answers
  const answer = epsilon > 0
    ? noisySpotter(question.evaluate, trueBoard, epsilon, () => spotterRng.next())
    : oracleSpotter(question.evaluate, trueBoard);

  // Update particles with answer
  particles.observeAnswer(question.evaluate, answer, epsilon);

  return {
    action: "question",
    questionText: question.text,
    questionAnswer: answer,
    eig: question.eig,
  };
}

function getQuestionId(question: ScoredQuestion): string {
  return typeof question.id === "string" && question.id.length > 0
    ? question.id
    : question.text;
}

async function executeRandomTurn(
  runtime: any,
  gameState: GameState,
  particles: BeliefState,
  rng: SeededRandom,
  revealedCells: Set<number>,
): Promise<TurnResult> {
  // Random: pick a random unrevealed cell
  const unrevealed: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (!revealedCells.has(i)) unrevealed.push(i);
  }

  if (unrevealed.length === 0) {
    // Should not happen, but safety
    return { action: "shoot", cellId: "A1" };
  }

  const cellIndex = unrevealed[rng.nextInt(unrevealed.length)];
  const cellIdStr = indexToCellId(cellIndex);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, cellIdStr));

  const cell = gameState.getCell(cellIdStr);
  const isHit = cell?.hasShip ?? false;
  if (cell) cell.status = isHit ? "hit" : "miss";

  if (isHit) {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, cellIdStr));
    if (cell?.shipId) {
      const ship = gameState.ships.get(cell.shipId);
      if (ship) { ship.hitCount++; if (ship.hitCount >= ship.size) ship.sunk = true; }
    }
  } else {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, cellIdStr));
  }

  if (gameState.allShipsSunk()) {
    await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.endGame, "won"));
  }

  particles.observeShot(cellIndex, isHit);
  return { action: "shoot", cellId: cellIdStr };
}
