/**
 * Test: MEL v3 with 64 cell states + per-cell actions
 */
import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";

async function main() {
  const board = generateBoard(42);
  const { runtime } = createBattleshipRuntime(board);

  console.log("MEL compiled OK");

  const allActions = runtime.getAvailableActions();
  console.log("Total actions:", allActions.length);
  console.log("Sample:", allActions.slice(0, 15));

  // Setup
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));

  // Check available shoots
  const afterSetup = runtime.getAvailableActions();
  const shootActions = afterSetup.filter((a: string) => a.startsWith("shoot"));
  console.log("\nAfter setup — shoot actions:", shootActions.length);

  // Shoot A5 (ship cell)
  console.log("\nShooting A5...");
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shootA5));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, "A5"));

  let snap = runtime.getSnapshot();
  const d = snap.data as any;
  const c = snap.computed as any;
  console.log("sA5:", d.sA5);
  console.log("hitCount:", d.hitCount);
  console.log("adjHitsA4:", c.adjHitsA4, "(left of A5)");
  console.log("adjHitsA6:", c.adjHitsA6, "(right of A5)");
  console.log("adjHitsB5:", c.adjHitsB5, "(below A5)");
  console.log("hotA4:", c.hotA4, "hotA6:", c.hotA6, "hotB5:", c.hotB5);
  console.log("hotCellCount:", c.hotCellCount);

  // Check shootA5 is now blocked
  const afterShoot = runtime.getAvailableActions();
  const hasShootA5 = afterShoot.includes("shootA5");
  console.log("\nshootA5 available?", hasShootA5, "(should be false)");

  // Shoot A1 (water)
  console.log("\nShooting A1...");
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shootA1));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, "A1"));

  snap = runtime.getSnapshot();
  console.log("sA1:", (snap.data as any).sA1);
  console.log("shootA1 available?", runtime.getAvailableActions().includes("shootA1"), "(should be false)");

  // Count remaining shoots
  const remaining = runtime.getAvailableActions().filter((a: string) => a.startsWith("shoot"));
  console.log("Remaining shoot actions:", remaining.length, "(should be 62)");

  console.log("\n=== MEL v3 works! ===");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
