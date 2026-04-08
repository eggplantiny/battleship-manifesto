/**
 * Manifesto-native prompt construction.
 *
 * Feeds the LLM everything Manifesto provides:
 * 1. MEL source — domain structure
 * 2. Causal graph — what depends on what
 * 3. Snapshot — current state + computed values
 * 4. Available actions — what the Captain can do
 * 5. Board ASCII — visual game state
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GameState } from "../../domain/game-state.js";

let melSourceCache: string | null = null;

function getMelSource(): string {
  if (!melSourceCache) {
    const melPath = resolve(import.meta.dirname, "../../domain/battleship.mel");
    melSourceCache = readFileSync(melPath, "utf-8");
  }
  return melSourceCache;
}

/** Format schema graph edges into readable causal chains */
function formatCausalGraph(graph: any): string {
  const lines: string[] = [];

  // Group edges by relation
  const mutates: string[] = [];
  const feeds: string[] = [];
  const unlocks: string[] = [];

  for (const e of graph.edges) {
    const from = e.from.replace(/^(state|computed|action):/, "");
    const to = e.to.replace(/^(state|computed|action):/, "");
    switch (e.relation) {
      case "mutates": mutates.push(`${from} → ${to}`); break;
      case "feeds": feeds.push(`${from} → ${to}`); break;
      case "unlocks": unlocks.push(`${from} → ${to}`); break;
    }
  }

  if (mutates.length) lines.push(`Mutations: ${mutates.join(", ")}`);
  if (feeds.length) lines.push(`Dependencies: ${feeds.join(", ")}`);
  if (unlocks.length) lines.push(`Preconditions: ${unlocks.join(", ")}`);

  return lines.join("\n");
}

/** Format available actions with their metadata */
function formatAvailableActions(runtime: any): string {
  const available = runtime.getAvailableActions() as string[];
  const metas = runtime.getActionMetadata() as any[];
  const lines: string[] = [];

  for (const meta of metas) {
    const isAvailable = available.includes(meta.name);
    const params = meta.params.length > 0 ? `(${meta.params.join(", ")})` : "()";
    const status = isAvailable ? "AVAILABLE" : "BLOCKED";
    lines.push(`  ${meta.name}${params} — ${status}`);
  }

  return lines.join("\n");
}

/** Build the full Manifesto-native prompt */
export function buildManifestoPrompt(
  runtime: any,
  gameState: GameState,
  previousQuestions: string[],
  count: number = 5,
): string {
  const snap = runtime.getSnapshot();
  const data = snap.data as any;
  const computed = snap.computed as any;
  const graph = runtime.getSchemaGraph();

  const boardAscii = gameState.toAscii();

  const prevQStr = previousQuestions.length > 0
    ? `\nAlready asked:\n${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
    : "";

  return `Collaborative Battleship. 8x8 board, 4 ships (sizes 2,3,4,5), horizontal/vertical.

## Domain Structure
State: hitCount, missCount, shotsFired, shotsRemaining(${data.shotsRemaining}), questionsRemaining(${data.questionsRemaining})
Computed: targetingF1 = f(precision, recall), precision = hitCount/shotsFired, recall = hitCount/totalShipCells
Causal: hitCount feeds → targetingF1, progress, shipCellsRemaining. To improve F1, increase hitCount.

## Current State
shotsFired: ${data.shotsFired}, hits: ${data.hitCount}, misses: ${data.missCount}
shipCellsRemaining: ${computed.shipCellsRemaining} of ${data.totalShipCells}
progress: ${(computed.progress * 100).toFixed(1)}%, F1: ${computed.targetingF1.toFixed(3)}

## Board (- = unknown, X = hit, O = miss)
${boardAscii}
${prevQStr}

Generate ${count} different yes/no questions about hidden ships.
For each, write a JS arrow function: (b) => b.cells.filter(c => CONDITION).some(c => c.hasShip)
where b.cells is array of {row(0-7), col(0-7), hasShip, shipId}.

Respond ONLY with a JSON array like: [{"text":"...","eval":"(b) => ..."},{"text":"...","eval":"(b) => ..."}]
Ask diverse questions (rows, columns, regions, ship sizes). Don't repeat previous questions.`;
}

/**
 * Legacy prompt for backward compatibility.
 */
export function buildQuestionPrompt(
  gameState: GameState,
  snapshotData: Record<string, unknown>,
  snapshotComputed: Record<string, unknown>,
  previousQuestions: string[],
  count: number = 5,
): string {
  const boardAscii = gameState.toAscii();

  const stats = [
    `Shots fired: ${snapshotData.shotsFired}`,
    `Hits: ${snapshotData.hitCount}`,
    `Misses: ${snapshotData.missCount}`,
    `Shots remaining: ${snapshotData.shotsRemaining}`,
    `Questions remaining: ${snapshotData.questionsRemaining}`,
    `Total ship cells: ${snapshotData.totalShipCells}`,
    `Ship cells remaining: ${snapshotComputed.shipCellsRemaining}`,
    `Hit rate: ${Number(snapshotComputed.hitRate).toFixed(2)}`,
    `Progress: ${(Number(snapshotComputed.progress) * 100).toFixed(1)}%`,
  ].join("\n");

  const prevQStr = previousQuestions.length > 0
    ? `\nQuestions already asked:\n${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
    : "";

  return `You are the Captain in a Collaborative Battleship game on an 8x8 board.
There are 4 hidden ships (sizes 2, 3, 4, 5). Ships are horizontal or vertical.
You can ask yes/no questions to a Spotter who sees the full board.

Current board (- = unknown, O = miss, X = hit):
${boardAscii}

Stats:
${stats}
${prevQStr}

Generate exactly ${count} diverse yes/no questions about the hidden ships.
For each question, provide a JavaScript arrow function that takes a board object
with a \`cells\` array (64 objects with {row, col, hasShip, shipId}) and a \`ships\` array
(objects with {id, size, color}) and returns true for "yes", false for "no".

Respond in JSON format:
[
  {"text": "Is there a ship in row A?", "eval": "(b) => b.cells.filter(c => c.row === 0).some(c => c.hasShip)"},
  ...
]

Rules:
- Ask questions that would split possible boards roughly in half
- Don't repeat previous questions
- Use simple JS — no external libraries
- Rows: A=0, B=1, ..., H=7. Columns: 1=0, 2=1, ..., 8=7`;
}
