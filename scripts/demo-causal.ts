/**
 * Demo: Causal graph + explain — what Gabe doesn't have.
 *
 * Shows:
 * 1. Schema graph: dependency tracing between state/computed/actions
 * 2. Explain: mathematical derivation trace for computed values
 */
import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard, boardToAscii } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS, cellId } from "../src/domain/types.js";

async function main() {
  console.log("=== Manifesto Causal Demo ===\n");

  // Setup
  const board = generateBoard(42);
  const { runtime, gameState } = createBattleshipRuntime(board);

  await runtime.dispatchAsync(
    runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS)
  );

  // Simulate some shots
  const shotsToFire = [
    cellId(0, 4), // A5 — ship (hit)
    cellId(0, 0), // A1 — water (miss)
    cellId(5, 2), // F3 — ship (hit)
    cellId(3, 3), // D4 — water (miss)
    cellId(5, 3), // F4 — ship (hit)
  ];

  for (const id of shotsToFire) {
    await runtime.dispatchAsync(
      runtime.createIntent(runtime.MEL.actions.shoot, id)
    );
  }

  const snapshot = runtime.getSnapshot();
  const data = snapshot.data as any;
  const computed = snapshot.computed as any;

  console.log("Board (true):");
  console.log(boardToAscii(board, true));
  console.log();

  console.log("Captain's view:");
  console.log(gameState.toAscii());
  console.log();

  console.log("--- Snapshot Data ---");
  console.log(`  shotsFired: ${data.shotsFired}`);
  console.log(`  hitCount: ${data.hitCount}`);
  console.log(`  missCount: ${data.missCount}`);
  console.log(`  shotsRemaining: ${data.shotsRemaining}`);
  console.log();

  console.log("--- Computed Values ---");
  console.log(`  unknownCount: ${computed.unknownCount}`);
  console.log(`  shipCellsRemaining: ${computed.shipCellsRemaining}`);
  console.log(`  hitRate: ${computed.hitRate}`);
  console.log(`  progress: ${(computed.progress * 100).toFixed(1)}%`);
  console.log(`  targetingPrecision: ${computed.targetingPrecision}`);
  console.log(`  targetingRecall: ${computed.targetingRecall}`);
  console.log(`  targetingF1: ${computed.targetingF1}`);
  console.log(`  allShipsSunk: ${computed.allShipsSunk}`);
  console.log();

  // Schema Graph
  console.log("--- Schema Graph ---");
  try {
    const graph = (runtime as any).getSchemaGraph?.();
    if (graph) {
      console.log("  Nodes:", JSON.stringify(graph.nodes?.map?.((n: any) => n.id) ?? "N/A"));
      console.log("  Edges:", JSON.stringify(graph.edges?.length ?? "N/A"));
    } else {
      console.log("  (getSchemaGraph not available on this runtime)");
    }
  } catch (e) {
    console.log("  (getSchemaGraph error:", (e as Error).message, ")");
  }
  console.log();

  // Explain
  console.log("--- Explain: targetingF1 ---");
  try {
    const explanation = (runtime as any).explain?.("targetingF1");
    if (explanation) {
      console.log("  Value:", explanation.value);
      console.log("  Trace:", JSON.stringify(explanation.trace, null, 2));
    } else {
      console.log("  (explain not available on this runtime)");
    }
  } catch (e) {
    console.log("  (explain error:", (e as Error).message, ")");
  }
  console.log();

  // Demonstrate the value trace manually
  console.log("--- Manual Derivation Trace ---");
  const precision = data.hitCount / data.shotsFired;
  const recall = data.hitCount / data.totalShipCells;
  const f1 = 2 * precision * recall / (precision + recall);
  console.log(`  precision = hitCount(${data.hitCount}) / shotsFired(${data.shotsFired}) = ${precision.toFixed(4)}`);
  console.log(`  recall    = hitCount(${data.hitCount}) / totalShipCells(${data.totalShipCells}) = ${recall.toFixed(4)}`);
  console.log(`  F1        = 2 × ${precision.toFixed(4)} × ${recall.toFixed(4)} / (${precision.toFixed(4)} + ${recall.toFixed(4)}) = ${f1.toFixed(4)}`);
  console.log(`  Manifesto computed: ${computed.targetingF1.toFixed(4)}`);
  console.log(`  Match: ${Math.abs(f1 - computed.targetingF1) < 0.0001 ? "YES" : "NO"}`);
  console.log();

  // Available actions
  console.log("--- Available Actions ---");
  console.log("  ", runtime.getAvailableActions());
  console.log();

  console.log("=== Demo Complete ===");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
