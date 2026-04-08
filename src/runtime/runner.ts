/**
 * Game runner: takes a Strategy and plays a full game.
 *
 * No strategy-specific logic. Just: setup → loop(decideTurn → execute) → result.
 */
import type { Strategy, TurnContext, TurnOutcome } from "../strategies/strategy.js";
import type { ManifestoBridge } from "./bridge.js";
import type { GameState } from "../domain/game-state.js";
import type { Board } from "../domain/types.js";
import { TOTAL_CELLS, TOTAL_SHIP_CELLS, cellIdToIndex, indexToCellId } from "../domain/types.js";
import { createBeliefState } from "../belief/belief-factory.js";
import type { BeliefKind } from "../belief/belief-state.js";
import { SeededRandom } from "../board/generator.js";
import { boardToAscii } from "../board/generator.js";
import { executeShot, executeQuestion, executeWorldShot } from "./game-loop.js";
import type { GameLogger } from "../experiment/logging.js";
import { summarizeDecision, summarizeSnapshot } from "../experiment/logging.js";
import type { BattleshipEffectTelemetryStore } from "../domain/effect-telemetry.js";

export interface GameConfig {
  beliefKind: BeliefKind;
  particleCount: number;
  epsilon: number;
  worldMode?: boolean;
  logger?: GameLogger;
  effectTelemetry?: BattleshipEffectTelemetryStore;
}

export interface GameResult {
  boardId: string;
  seed: number;
  strategyName: string;
  policyName?: string;
  shotsFired: number;
  questionsAsked: number;
  hitCount: number;
  missCount: number;
  totalShipCells: number;
  targetingF1: number;
  won: boolean;
}

export async function playGame(
  bridge: ManifestoBridge,
  gameState: GameState,
  trueBoard: Board,
  strategy: Strategy,
  config: GameConfig,
  boardId: string,
  gameSeed: number,
): Promise<GameResult> {
  const particles = createBeliefState({
    kind: config.beliefKind,
    sampleCount: config.particleCount,
    seed: gameSeed,
  });
  const rng = new SeededRandom(gameSeed);
  const spotterRng = new SeededRandom(gameSeed + 1_000_003);
  const askedQuestions = new Set<string>();
  const logger = config.logger;

  if (config.worldMode) {
    await bridge.dispatch("initCells", createWorldCells());
  }
  await bridge.dispatch("setupBoard", TOTAL_SHIP_CELLS);

  logger?.log({
    turn: 0,
    source: "runner",
    type: "game_start",
    snapshot: summarizeSnapshot(bridge.data, bridge.computed),
    data: {
      boardId,
      seed: gameSeed,
      captainBoardAscii: gameState.toAscii(),
      trueBoardAscii: boardToAscii(trueBoard, true),
    },
  });

  const ctx: TurnContext = {
    bridge,
    boardId,
    gameState,
    trueBoard,
    particles,
    rng,
    askedQuestions,
    epsilon: config.epsilon,
    logger,
    effectTelemetry: config.effectTelemetry,
  };
  let turnIndex = 0;

  try {
    while (true) {
      const data = bridge.data;
      if (data.phase === "won" || data.phase === "lost" || (data.shotsRemaining as number) <= 0) break;
      if (gameState.allShipsSunk()) { await bridge.dispatch("endGame", "won"); break; }

      turnIndex += 1;
      logger?.log({
        turn: turnIndex,
        source: "runner",
        type: "turn_start",
        snapshot: summarizeSnapshot(bridge.data, bridge.computed),
        data: {
          boardAscii: gameState.toAscii(),
        },
      });

      const decision = await strategy.decideTurn(ctx);
      logger?.log({
        turn: turnIndex,
        source: "runner",
        type: "decision",
        snapshot: summarizeSnapshot(bridge.data, bridge.computed),
        data: summarizeDecision(decision),
      });

      if (decision.action === "shoot" && (decision.cellId || decision.cellIndex !== undefined)) {
        if (!decision.cellId) {
          throw new Error("Shot decision is missing cellId");
        }
        const result = config.worldMode
          ? await executeWorldShot(bridge, gameState, particles, decision.cellId)
          : await executeShot(bridge, gameState, particles, decision.cellId!);
        logger?.log({
          turn: turnIndex,
          source: "runner",
          type: "shot_result",
          snapshot: summarizeSnapshot(bridge.data, bridge.computed),
          data: {
            cellId: result.cellId,
            cellIndex: decision.cellIndex ?? cellIdToIndex(result.cellId),
            isHit: result.isHit,
            boardAscii: gameState.toAscii(),
          },
        });
        await strategy.afterTurn?.(ctx, {
          action: "shoot",
          cellId: result.cellId,
          cellIndex: decision.cellIndex ?? cellIdToIndex(result.cellId),
          isHit: result.isHit,
        } satisfies TurnOutcome);
      } else if (decision.action === "question" && decision.questionId && decision.questionText && decision.evaluate) {
        const result = await executeQuestion(
          bridge,
          gameState,
          trueBoard,
          particles,
          decision.questionId,
          decision.questionText,
          decision.evaluate,
          config.epsilon,
          () => spotterRng.next(),
        );
        logger?.log({
          turn: turnIndex,
          source: "runner",
          type: "question_result",
          snapshot: summarizeSnapshot(bridge.data, bridge.computed),
          data: {
            id: result.id,
            text: result.text,
            answer: result.answer,
            source: decision.questionSource ?? null,
            questionSpec: decision.questionSpec ?? null,
            boardAscii: gameState.toAscii(),
          },
        });
        await strategy.afterTurn?.(ctx, {
          action: "question",
          questionId: result.id,
          questionText: result.text,
          questionSource: decision.questionSource,
          questionSpec: decision.questionSpec,
          answer: result.answer,
        } satisfies TurnOutcome);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.log({
      turn: turnIndex,
      source: "runner",
      type: "error",
      snapshot: summarizeSnapshot(bridge.data, bridge.computed),
      data: {
        message,
      },
    });
    logger?.abort({
      message,
      turn: turnIndex,
    });
    throw error;
  }

  const snap = bridge.snapshot;
  const d = snap.data as any;
  const c = snap.computed as any;

  const result: GameResult = {
    boardId,
    seed: gameSeed,
    strategyName: strategy.name,
    policyName: strategy.policyName,
    shotsFired: d.shotsFired,
    questionsAsked: d.questionsAsked,
    hitCount: d.hitCount,
    missCount: d.missCount,
    totalShipCells: d.totalShipCells,
    targetingF1: c.targetingF1 ?? 0,
    won: d.phase === "won",
  };

  logger?.log({
    turn: turnIndex,
    source: "runner",
    type: "game_end",
    snapshot: summarizeSnapshot(bridge.data, bridge.computed),
    data: {
      shotsFired: result.shotsFired,
      questionsAsked: result.questionsAsked,
      hitCount: result.hitCount,
      missCount: result.missCount,
      targetingF1: result.targetingF1,
      won: result.won,
    },
  });
  logger?.close(result);

  return result;
}

function createWorldCells() {
  return Array.from({ length: TOTAL_CELLS }, (_, index) => ({
    id: indexToCellId(index),
    status: "unknown",
  }));
}
