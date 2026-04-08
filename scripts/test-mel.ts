/**
 * Test: MEL compilation + runtime + game loop basics
 * Run: npx tsx scripts/test-mel.ts
 */
import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard, boardToAscii } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS, cellId } from "../src/domain/types.js";

async function main() {
  console.log("=== Battleship MEL Test ===\n");

  // 1. Generate board
  console.log("1. Board (seed=42):");
  const board = generateBoard(42);
  console.log(boardToAscii(board, true));
  console.log();

  // 2. Create runtime
  console.log("2. Creating runtime...");
  const { runtime, gameState } = createBattleshipRuntime(board);
  console.log("   OK\n");

  // 3. Setup
  console.log("3. Setting up board...");
  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS)
  );
  let snap = runtime.getSnapshot();
  console.log("   phase:", (snap.data as any).phase);
  console.log("   totalShipCells:", (snap.data as any).totalShipCells);
  console.log("   unknownCount:", (snap.computed as any).unknownCount);
  console.log();

  // 4. Shoot a ship cell
  const shipCell = board.cells.find((c) => c.hasShip)!;
  const shipCellIdStr = cellId(shipCell.row, shipCell.col);
  console.log(`4. Shooting ${shipCellIdStr} (ship)...`);
  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.shoot, shipCellIdStr)
  );
  snap = runtime.getSnapshot();
  console.log("   lastShotResult:", (snap.data as any).lastShotResult);
  console.log("   hitCount:", (snap.data as any).hitCount);
  console.log("   targetingF1:", (snap.computed as any).targetingF1);
  console.log();

  // 5. Shoot a water cell
  const waterCell = board.cells.find((c) => !c.hasShip)!;
  const waterCellIdStr = cellId(waterCell.row, waterCell.col);
  console.log(`5. Shooting ${waterCellIdStr} (water)...`);
  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.shoot, waterCellIdStr)
  );
  snap = runtime.getSnapshot();
  console.log("   lastShotResult:", (snap.data as any).lastShotResult);
  console.log("   hitCount:", (snap.data as any).hitCount);
  console.log("   missCount:", (snap.data as any).missCount);
  console.log("   targetingF1:", (snap.computed as any).targetingF1);
  console.log();

  // 6. Ask a question
  console.log("6. Asking question...");
  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.askQuestion, "row:A", "Is there a ship in row A?")
  );
  snap = runtime.getSnapshot();
  console.log("   questionsRemaining:", (snap.data as any).questionsRemaining);
  console.log("   lastQuestionId:", (snap.data as any).lastQuestionId);
  console.log();

  // 7. Board view
  console.log("7. Captain's view:");
  console.log(gameState.toAscii());
  console.log();

  // 8. Available actions
  console.log("8. Available actions:", runtime.getAvailableActions());
  console.log();

  console.log("=== All tests passed! ===");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
