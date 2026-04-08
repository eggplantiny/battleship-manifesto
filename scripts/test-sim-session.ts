/**
 * Test: createSimulationSession — chained simulation
 */
import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard, boardToAscii } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";
import { createSimulationSession } from "@manifesto-ai/sdk/extensions";

async function main() {
  const board = generateBoard(42);
  const { runtime, gameState } = createBattleshipRuntime(board);

  // Setup and fire 2 shots via dispatch (real game actions)
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A5"));
  // A5 is a ship → recordHit
  gameState.cells.get("A5")!.status = "hit";
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, "A5"));

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A1"));
  // A1 is water → recordMiss
  gameState.cells.get("A1")!.status = "miss";
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, "A1"));

  console.log("Board:");
  console.log(boardToAscii(board, true));
  console.log("\nCurrent:", JSON.stringify(runtime.getSnapshot().computed));

  // --- Simulation Session: shoot scenarios ---
  const sim = createSimulationSession(runtime);

  // "What if I shoot F3 and it's a hit?"
  const shootHit = sim
    .next(runtime.MEL.actions.shoot, "F3")
    .next(runtime.MEL.actions.recordHit, "F3");
  console.log("\n--- shoot F3 → hit ---");
  console.log("depth:", shootHit.depth);
  console.log("computed:", JSON.stringify(shootHit.snapshot.computed));

  // "What if I shoot F3 and it's a miss?"
  const shootMiss = sim
    .next(runtime.MEL.actions.shoot, "F3")
    .next(runtime.MEL.actions.recordMiss, "F3");
  console.log("\n--- shoot F3 → miss ---");
  console.log("computed:", JSON.stringify(shootMiss.snapshot.computed));

  // --- Simulation Session: question → answer → shoot ---
  // "What if I ask a question, get yes, then shoot the best cell?"
  const askThenShootHit = sim
    .next(runtime.MEL.actions.askQuestion, "row:F", "Is there a ship in row F?")
    .next(runtime.MEL.actions.shoot, "F4")
    .next(runtime.MEL.actions.recordHit);
  console.log("\n--- ask 'Row F?' → shoot F4 → hit (3-step) ---");
  console.log("depth:", askThenShootHit.depth);
  console.log("computed:", JSON.stringify(askThenShootHit.snapshot.computed));
  console.log("F1:", (askThenShootHit.snapshot.computed as any).targetingF1.toFixed(4));

  // Compare: shoot directly vs ask+shoot
  console.log("\n=== Comparison ===");
  console.log("Current F1:         ", (runtime.getSnapshot().computed as any).targetingF1.toFixed(4));
  console.log("After shoot→hit:    ", (shootHit.snapshot.computed as any).targetingF1.toFixed(4));
  console.log("After ask→shoot→hit:", (askThenShootHit.snapshot.computed as any).targetingF1.toFixed(4));

  // Original unchanged
  console.log("\nOriginal still:", JSON.stringify(runtime.getSnapshot().data));

  console.log("\n=== SimulationSession works! ===");
}

main().catch(console.error);
