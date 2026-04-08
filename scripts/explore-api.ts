import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const board = generateBoard(42);
  const { runtime } = createBattleshipRuntime(board);
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A5"));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A1"));

  console.log("=== Available Actions ===");
  console.log(runtime.getAvailableActions());

  console.log("\n=== Action Metadata ===");
  const metas = runtime.getActionMetadata();
  for (const m of metas) {
    console.log(JSON.stringify(m));
  }

  console.log("\n=== SchemaGraph ===");
  const graph = runtime.getSchemaGraph();
  console.log("Nodes:");
  for (const n of graph.nodes) console.log(`  ${n.id} (${n.kind})`);
  console.log("Edges:");
  for (const e of graph.edges) console.log(`  ${e.from} → ${e.to} [${e.relation}]`);

  console.log("\n=== traceDown('computed:targetingF1') ===");
  const sub = graph.traceDown("computed:targetingF1");
  console.log("Nodes:", sub.nodes.map((n: any) => n.id));
  console.log("Edges:", sub.edges.map((e: any) => `${e.from} → ${e.to}`));

  console.log("\n=== traceUp('action:shoot') ===");
  const up = graph.traceUp("action:shoot");
  console.log("Nodes:", up.nodes.map((n: any) => n.id));
  console.log("Edges:", up.edges.map((e: any) => `${e.from} → ${e.to}`));

  console.log("\n=== Snapshot ===");
  const snap = runtime.getSnapshot();
  console.log("data:", JSON.stringify(snap.data, null, 2));
  console.log("computed:", JSON.stringify(snap.computed, null, 2));

  console.log("\n=== simulate(shoot, 'F3') ===");
  const simResult = runtime.simulate(runtime.MEL.actions.shoot, "F3");
  console.log("changedPaths:", simResult.changedPaths);
  console.log("newAvailableActions:", simResult.newAvailableActions);
  console.log("sim snapshot data:", JSON.stringify(simResult.snapshot.data, null, 2));
  console.log("sim snapshot computed:", JSON.stringify(simResult.snapshot.computed, null, 2));

  console.log("\n=== MEL source ===");
  const melPath = resolve(import.meta.dirname, "../src/domain/battleship.mel");
  console.log(readFileSync(melPath, "utf-8").substring(0, 200) + "...");
}

main().catch(console.error);
