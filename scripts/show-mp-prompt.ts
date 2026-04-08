import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";

async function main() {
  const board = generateBoard(42);
  const { runtime, gameState } = createBattleshipRuntime(board);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  // Start turn to get think budget
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.startTurn));

  // Simulate some shots
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shootA5));
  gameState.cells.get("A5")!.status = "hit";
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, "A5"));

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shootA1));
  gameState.cells.get("A1")!.status = "miss";
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordMiss, "A1"));

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shootF3));
  gameState.cells.get("F3")!.status = "hit";
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, "F3"));

  // Build prompt using the same function as MP agent
  const snap = runtime.getSnapshot();
  const d = snap.data as any;
  const c = snap.computed as any;
  const graph = runtime.getSchemaGraph();
  const available = runtime.getAvailableActions() as string[];

  const rows = ["A", "B", "C", "D", "E", "F", "G", "H"];
  let board2 = "  1 2 3 4 5 6 7 8\n";
  for (let r = 0; r < 8; r++) {
    let line = `${rows[r]} `;
    for (let col = 0; col < 8; col++) {
      const st = d[`s${rows[r]}${col + 1}`];
      line += st === "hit" ? "X " : st === "miss" ? "O " : "- ";
    }
    board2 += line + "\n";
  }

  const hotCells: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      const name = `${rows[r]}${col + 1}`;
      if (c[`hot${name}`]) hotCells.push(name);
    }
  }

  const shoots = available.filter((a: string) => a.startsWith("shoot"));
  const thinks = available.filter((a: string) => a.startsWith("think"));
  const others = available.filter((a: string) => !a.startsWith("shoot") && !a.startsWith("think"));

  const causalEdges = graph.edges
    .filter((e: any) => e.relation === "feeds")
    .map((e: any) => `${e.from.replace(/^(state|computed):/, "")} → ${e.to.replace(/^(state|computed):/, "")}`)
    .join(", ");

  const computedStr = Object.entries(c)
    .filter(([k]) => !k.startsWith("adjHits") && !k.startsWith("hot") && k !== "boardValue")
    .map(([k, v]) => `  ${k}: ${typeof v === "number" ? (v as number).toFixed(3) : v}`)
    .join("\n");

  console.log(`Board:
${board2}
Snapshot:
${computedStr}

Causal: ${causalEdges}

Hot cells: ${hotCells.length > 0 ? hotCells.join(", ") : "none"}

Available:
  think: ${thinks.length > 0 ? thinks.map((t: string) => t.slice(5)).join(", ") : "none (budget=0)"}
  shoot: ${shoots.map((s: string) => s.slice(5)).join(", ")}
  other: ${others.join(", ")}

Reply with one action name: thinkD5, shootD6, or askQuestion`);
}
main().catch(console.error);
