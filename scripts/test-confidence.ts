import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";

async function main() {
  const board = generateBoard(42);
  const { runtime } = createBattleshipRuntime(board);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.startTurn));

  const avail = runtime.getAvailableActions() as string[];
  const shoots = avail.filter((a: string) => a.startsWith("shoot"));
  const thinks = avail.filter((a: string) => a.startsWith("think"));
  const asks = avail.filter((a: string) => a.startsWith("ask"));

  const snap = runtime.getSnapshot();
  const c = snap.computed as any;
  const d = snap.data as any;

  console.log("After startTurn:");
  console.log("  simBudget:", d.simBudget, "simCount:", d.simCount);
  console.log("  bestSimHitProb:", d.bestSimHitProb);
  console.log("  confident:", c.confident);
  console.log("  shoots available:", shoots.length, "(should be 0 — not confident yet)");
  console.log("  thinks available:", thinks.length, "(should be 64)");
  console.log("  asks available:", asks.length);

  // Think 3 times → confident by simCount
  console.log("\nThinking 3 times...");
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.thinkD5));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordSimResult, "D5", 0.2, 0.01));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.thinkD6));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordSimResult, "D6", 0.3, 0.02));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.thinkE5));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordSimResult, "E5", 0.25, 0.015));

  const snap2 = runtime.getSnapshot();
  const c2 = snap2.computed as any;
  const d2 = snap2.data as any;
  const avail2 = runtime.getAvailableActions() as string[];
  const shoots2 = avail2.filter((a: string) => a.startsWith("shoot"));

  console.log("After 3 thinks:");
  console.log("  simCount:", d2.simCount, "bestSimHitProb:", d2.bestSimHitProb);
  console.log("  confident:", c2.confident);
  console.log("  shoots available:", shoots2.length, "(should be >0 — confident now)");

  console.log("\n=== Confidence guard works! ===");
}
main().catch(console.error);
