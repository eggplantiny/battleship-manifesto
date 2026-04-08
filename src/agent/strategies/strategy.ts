/**
 * Strategy interface: every agent implements this.
 *
 * The runner calls decideTurn() each turn.
 * The strategy returns what to do — the runner executes it.
 */
import type { ManifestoBridge } from "../core/bridge.js";
import type { GameState } from "../../domain/game-state.js";
import type { Board } from "../../domain/types.js";
import type { BeliefState } from "../belief-state.js";
import type { SeededRandom } from "../../board/generator.js";
import type { GameLogger } from "../../experiment/logging.js";
import type { BattleshipEffectTelemetryStore } from "../../domain/effect-telemetry.js";

export interface TurnContext {
  bridge: ManifestoBridge;
  boardId: string;
  gameState: GameState;
  trueBoard: Board;
  particles: BeliefState;
  rng: SeededRandom;
  askedQuestions: Set<string>;
  epsilon: number;
  logger?: GameLogger;
  effectTelemetry?: BattleshipEffectTelemetryStore;
}

export interface TurnDecision {
  action: "shoot" | "question";
  cellId?: string;
  cellIndex?: number;
  questionId?: string;
  questionText?: string;
  questionSource?: "template" | "synthesized";
  questionSpec?: unknown;
  evaluate?: (board: Board) => boolean;
}

export type TurnOutcome =
  | {
      action: "shoot";
      cellId: string;
      cellIndex: number;
      isHit: boolean;
    }
  | {
      action: "question";
      questionId: string;
      questionText: string;
      questionSource?: "template" | "synthesized";
      questionSpec?: unknown;
      answer: boolean;
    };

export interface Strategy {
  name: string;
  policyName?: string;
  decideTurn(ctx: TurnContext): Promise<TurnDecision>;
  afterTurn?(ctx: TurnContext, outcome: TurnOutcome): Promise<void>;
}
