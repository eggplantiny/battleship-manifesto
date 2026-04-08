import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createManifesto } from "@manifesto-ai/sdk";
import { withLineage, createInMemoryLineageStore } from "@manifesto-ai/lineage";
import { GameState } from "./game-state.js";
import type { Board } from "./types.js";
import { createBattleshipEffects, type BattleshipEffectOptions } from "./effects.js";
import { BattleshipEffectTelemetryStore } from "./effect-telemetry.js";

function readMel(filename: string): string {
  return readFileSync(resolve(import.meta.dirname, filename), "utf-8");
}

/** Base runtime (dispatchAsync) — M agent and baselines */
export function createBattleshipRuntime(board: Board) {
  const gameState = new GameState(board);
  const runtime = createManifesto(readMel("battleship.mel"), {}).activate();
  return { runtime, gameState };
}

/** Base runtime with revealed board in MEL — WMA agent */
export function createBattleshipWorldRuntime(board: Board) {
  const gameState = new GameState(board);
  const runtime = createManifesto(readMel("battleship-world.mel"), {}).activate();
  return { runtime, gameState, worldMode: true as const };
}

/** Reflective world runtime — MRA agent */
export function createBattleshipReflectiveRuntime(board: Board) {
  const gameState = new GameState(board);
  const runtime = createManifesto(readMel("battleship-reflective.mel"), {}).activate();
  return { runtime, gameState, worldMode: true as const, reflectiveMode: true as const };
}

/** Lineage runtime (commitAsync) — MP agent */
export function createBattleshipLineageRuntime(
  board: Board,
  effectOptions: BattleshipEffectOptions = {},
) {
  const gameState = new GameState(board);
  const effectTelemetry = new BattleshipEffectTelemetryStore();
  const runtime = withLineage(
    createManifesto(
      readMel("battleship-mp.mel"),
      createBattleshipEffects({
        ...effectOptions,
        telemetry: effectTelemetry,
      }),
    ),
    { store: createInMemoryLineageStore() },
  ).activate();
  return { runtime, gameState, effectTelemetry };
}
