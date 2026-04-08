/**
 * MEL codegen: generates battleship.mel with 64 cell states,
 * per-cell shoot/think actions with available when guards,
 * and adjacency-based computed values.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIZE = 8;

function cellName(r: number, c: number): string {
  return `${ROWS[r]}${COLS[c]}`;
}

function stateField(r: number, c: number): string {
  return `s${cellName(r, c)}`;
}

function generate(): string {
  const lines: string[] = [];

  lines.push("domain Battleship {");
  lines.push("");
  lines.push("  state {");
  lines.push("    totalShipCells: number = 0");
  lines.push("    turnNumber: number = 0");
  lines.push("    shotsRemaining: number = 40");
  lines.push("    questionsRemaining: number = 15");
  lines.push("    shotsFired: number = 0");
  lines.push("    questionsAsked: number = 0");
  lines.push("    hitCount: number = 0");
  lines.push("    missCount: number = 0");
  lines.push("    phase: string = \"setup\"");
  lines.push("    lastShotResult: string = \"\"");
  lines.push("    lastShotCellId: string = \"\"");
  lines.push("    lastQuestionId: string = \"\"");
  lines.push("");
  lines.push("    simBudget: number = 0");
  lines.push("    simCount: number = 0");
  lines.push("    bestSimCell: string = \"\"");
  lines.push("    bestSimHitProb: number = 0");
  lines.push("    bestSimBoardValue: number = 0");
  lines.push("    lastSimCell: string = \"\"");
  lines.push("    lastSimHitProb: number = 0");
  lines.push("    lastSimBoardValue: number = 0");
  lines.push("    thinkingPhase: string = \"idle\"");
  lines.push("");

  // Question asked tracking
  lines.push("    // Question tracking: asked or not");
  for (let r = 0; r < SIZE; r++) {
    lines.push(`    askedRow${ROWS[r]}: string = "no"`);
  }
  for (let c = 0; c < SIZE; c++) {
    lines.push(`    askedCol${COLS[c]}: string = "no"`);
  }
  lines.push("");

  // 64 cell states
  lines.push("    // Cell states: unknown | hit | miss");
  for (let r = 0; r < SIZE; r++) {
    const rowCells = [];
    for (let c = 0; c < SIZE; c++) {
      rowCells.push(`${stateField(r, c)}: string = "unknown"`);
    }
    lines.push(`    ${rowCells.join("  ")}`);
  }
  lines.push("  }");
  lines.push("");

  // --- Computed ---

  // hitCount/missCount from cell states
  // (We keep hitCount/missCount as state patched by recordHit/recordMiss for simplicity)

  lines.push("  computed unknownCount = sub(64, add(hitCount, missCount))");
  lines.push("  computed shipCellsRemaining = sub(totalShipCells, hitCount)");
  lines.push("  computed allShipsSunk = eq(shipCellsRemaining, 0)");
  lines.push("  computed hitRate = cond(eq(shotsFired, 0), 0, div(hitCount, shotsFired))");
  lines.push("  computed progress = cond(eq(totalShipCells, 0), 0, div(hitCount, totalShipCells))");
  lines.push("  computed targetingPrecision = cond(eq(shotsFired, 0), 0, div(hitCount, shotsFired))");
  lines.push("  computed targetingRecall = cond(eq(totalShipCells, 0), 0, div(hitCount, totalShipCells))");
  lines.push("  computed targetingF1 = cond(");
  lines.push("    eq(add(targetingPrecision, targetingRecall), 0),");
  lines.push("    0,");
  lines.push("    div(mul(2, mul(targetingPrecision, targetingRecall)), add(targetingPrecision, targetingRecall))");
  lines.push("  )");
  lines.push("  computed confident = or(gt(bestSimHitProb, 0.5), gte(simCount, 3), eq(simBudget, 0))");
  lines.push("  computed shouldAct = or(eq(simBudget, 0), gt(bestSimHitProb, 0.7))");
  lines.push("  computed boardValue = progress");
  lines.push("");

  // Per-cell adjacency: count of adjacent cells that are "hit"
  lines.push("  // Adjacent hit counts per cell");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      const adj: string[] = [];
      if (r > 0) adj.push(`cond(eq(${stateField(r-1, c)}, "hit"), 1, 0)`);
      if (r < SIZE-1) adj.push(`cond(eq(${stateField(r+1, c)}, "hit"), 1, 0)`);
      if (c > 0) adj.push(`cond(eq(${stateField(r, c-1)}, "hit"), 1, 0)`);
      if (c < SIZE-1) adj.push(`cond(eq(${stateField(r, c+1)}, "hit"), 1, 0)`);

      // Build nested add
      let expr: string;
      if (adj.length === 1) expr = adj[0];
      else if (adj.length === 2) expr = `add(${adj[0]}, ${adj[1]})`;
      else if (adj.length === 3) expr = `add(${adj[0]}, add(${adj[1]}, ${adj[2]}))`;
      else expr = `add(add(${adj[0]}, ${adj[1]}), add(${adj[2]}, ${adj[3]}))`;

      lines.push(`  computed adjHits${name} = ${expr}`);
    }
  }
  lines.push("");

  // Hot cells: unknown AND adjacent to at least 1 hit
  lines.push("  // Hot cells: unknown + adjacent to hit");
  const hotCells: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      lines.push(`  computed hot${name} = and(eq(${stateField(r, c)}, "unknown"), gt(adjHits${name}, 0))`);
      hotCells.push(`cond(hot${name}, 1, 0)`);
    }
  }

  // Total hot cell count
  function buildSum(items: string[]): string {
    if (items.length === 1) return items[0];
    if (items.length === 2) return `add(${items[0]}, ${items[1]})`;
    const mid = Math.floor(items.length / 2);
    return `add(${buildSum(items.slice(0, mid))}, ${buildSum(items.slice(mid))})`;
  }
  lines.push(`  computed hotCellCount = ${buildSum(hotCells)}`);
  lines.push("");

  // --- Actions ---

  // setupBoard
  lines.push("  action setupBoard(shipCellCount: number) {");
  lines.push("    onceIntent {");
  lines.push("      patch totalShipCells = shipCellCount");
  lines.push("      patch phase = \"playing\"");
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // Per-cell shoot actions
  lines.push("  // Shoot actions — one per cell, available only if cell is unknown");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      const sf = stateField(r, c);
      lines.push(`  action shoot${name}() available when and(eq(phase, "playing"), eq(${sf}, "unknown"), gt(shotsRemaining, 0), confident) {`);
      lines.push("    onceIntent {");
      lines.push(`      patch turnNumber = add(turnNumber, 1)`);
      lines.push(`      patch shotsRemaining = sub(shotsRemaining, 1)`);
      lines.push(`      patch shotsFired = add(shotsFired, 1)`);
      lines.push(`      patch lastShotCellId = "${name}"`);
      lines.push("    }");
      lines.push("  }");
    }
  }
  lines.push("");

  // recordHit / recordMiss — update cell state + counters
  lines.push("  action recordHit(cellId: string) {");
  lines.push("    onceIntent {");
  lines.push("      patch hitCount = add(hitCount, 1)");
  lines.push("      patch lastShotResult = \"hit\"");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      const sf = stateField(r, c);
      lines.push(`      patch ${sf} = cond(eq(cellId, "${name}"), "hit", ${sf})`);
    }
  }
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  lines.push("  action recordMiss(cellId: string) {");
  lines.push("    onceIntent {");
  lines.push("      patch missCount = add(missCount, 1)");
  lines.push("      patch lastShotResult = \"miss\"");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      const sf = stateField(r, c);
      lines.push(`      patch ${sf} = cond(eq(cellId, "${name}"), "miss", ${sf})`);
    }
  }
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // Per-question ask actions — one per template question
  // Row questions (8)
  lines.push("  // Ask actions — available if not yet asked + budget remaining");
  for (let r = 0; r < SIZE; r++) {
    const label = ROWS[r];
    lines.push(`  action askRow${label}() available when and(eq(phase, "playing"), gt(questionsRemaining, 0), eq(askedRow${label}, "no")) {`);
    lines.push("    onceIntent {");
    lines.push(`      patch turnNumber = add(turnNumber, 1)`);
    lines.push(`      patch questionsRemaining = sub(questionsRemaining, 1)`);
    lines.push(`      patch questionsAsked = add(questionsAsked, 1)`);
    lines.push(`      patch askedRow${label} = "yes"`);
    lines.push("    }");
    lines.push("  }");
  }
  // Column questions (8)
  for (let c = 0; c < SIZE; c++) {
    lines.push(`  action askCol${COLS[c]}() available when and(eq(phase, "playing"), gt(questionsRemaining, 0), eq(askedCol${COLS[c]}, "no")) {`);
    lines.push("    onceIntent {");
    lines.push(`      patch turnNumber = add(turnNumber, 1)`);
    lines.push(`      patch questionsRemaining = sub(questionsRemaining, 1)`);
    lines.push(`      patch questionsAsked = add(questionsAsked, 1)`);
    lines.push(`      patch askedCol${COLS[c]} = "yes"`);
    lines.push("    }");
    lines.push("  }");
  }

  // receiveAnswer — records the answer for a question region
  lines.push("");
  lines.push("  action receiveAnswer(region: string, answer: string) {");
  lines.push("    onceIntent {");
  // No state change beyond what the agent tracks in TypeScript (particle reweight)
  // The answer itself is the observation — particles handle statistics
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // endGame
  lines.push("  action endGame(result: string) {");
  lines.push("    onceIntent {");
  lines.push("      patch phase = result");
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // startTurn
  lines.push("  action startTurn() available when eq(phase, \"playing\") {");
  lines.push("    onceIntent {");
  lines.push("      patch simBudget = 10");
  lines.push("      patch simCount = 0");
  lines.push("      patch bestSimCell = \"\"");
  lines.push("      patch bestSimHitProb = 0");
  lines.push("      patch bestSimBoardValue = 0");
  lines.push("      patch lastSimCell = \"\"");
  lines.push("      patch lastSimHitProb = 0");
  lines.push("      patch lastSimBoardValue = 0");
  lines.push("      patch thinkingPhase = \"planning\"");
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // Per-cell think actions — available only if unknown + budget > 0
  lines.push("  // Think actions — simulate a cell, available only if unknown + budget");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cellName(r, c);
      const sf = stateField(r, c);
      lines.push(`  action think${name}() available when and(eq(thinkingPhase, "planning"), eq(${sf}, "unknown"), gt(simBudget, 0)) {`);
      lines.push("    onceIntent {");
      lines.push(`      patch simBudget = sub(simBudget, 1)`);
      lines.push(`      patch simCount = add(simCount, 1)`);
      lines.push(`      patch lastSimCell = "${name}"`);
      lines.push("    }");
      lines.push("  }");
    }
  }
  lines.push("");

  // recordSimResult
  lines.push("  action recordSimResult(cell: string, hitProb: number, boardValue: number) {");
  lines.push("    onceIntent {");
  lines.push("      patch lastSimHitProb = hitProb");
  lines.push("      patch lastSimBoardValue = boardValue");
  lines.push("      patch bestSimCell = cond(gt(boardValue, bestSimBoardValue), cell, bestSimCell)");
  lines.push("      patch bestSimHitProb = cond(gt(boardValue, bestSimBoardValue), hitProb, bestSimHitProb)");
  lines.push("      patch bestSimBoardValue = cond(gt(boardValue, bestSimBoardValue), boardValue, bestSimBoardValue)");
  lines.push("    }");
  lines.push("  }");
  lines.push("");

  // commitAction
  lines.push("  action commitAction() {");
  lines.push("    onceIntent {");
  lines.push("      patch thinkingPhase = \"decided\"");
  lines.push("    }");
  lines.push("  }");

  lines.push("}");

  return lines.join("\n");
}

const mel = generate();
const outPath = resolve(import.meta.dirname, "../src/domain/battleship.mel");
writeFileSync(outPath, mel);
console.log(`Generated ${mel.split("\n").length} lines → ${outPath}`);

// Stats
const shootActions = 64;
const thinkActions = 64;
const cellStates = 64;
const adjComputed = 64;
const hotComputed = 64;
console.log(`  ${cellStates} cell states`);
console.log(`  ${shootActions} shoot actions + ${thinkActions} think actions`);
console.log(`  ${adjComputed} adjHits computed + ${hotComputed} hot computed`);
