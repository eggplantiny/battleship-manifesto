/**
 * MP Agent prompt: LLM sees state + simulation history + available actions.
 */
import type { GameState } from "../../domain/game-state.js";
import type { SimResult } from "../mp-simulate.js";

export interface MPPromptContext {
  snapshot: { data: any; computed: any };
  gameState: GameState;
  turnHistory: SimResult[];
  previousQuestions: string[];
}

export function buildMPPrompt(ctx: MPPromptContext): string {
  const { snapshot, gameState, turnHistory, previousQuestions } = ctx;
  const d = snapshot.data;
  const c = snapshot.computed;

  const board = gameState.toAscii();

  // Simulation history for this turn
  let simHistoryStr = "";
  if (turnHistory.length > 0) {
    const lines = turnHistory.map(
      (s) => `  think(${s.cell}) → hitProb=${s.hitProb.toFixed(2)}, boardValue=${s.boardValue.toFixed(3)}`,
    );
    simHistoryStr = `\nSimulations this turn (${turnHistory.length}/${d.simCount + d.simBudget}):\n${lines.join("\n")}`;
    simHistoryStr += `\nBest so far: ${d.bestSimCell} (hitProb=${d.bestSimHitProb.toFixed(2)}, boardValue=${d.bestSimBoardValue.toFixed(3)})`;
  }

  const prevQStr = previousQuestions.length > 0
    ? `\nQuestions asked: ${previousQuestions.join(", ")}`
    : "";

  return `Battleship 8x8. 4 ships (sizes 2,3,4,5). You are the Captain.

Board (- unknown, X hit, O miss):
${board}

State: ${d.shotsFired} shots (${d.hitCount} hits, ${d.missCount} misses), ${d.shotsRemaining} remaining
Questions: ${d.questionsAsked} asked, ${d.questionsRemaining} remaining
Progress: ${(c.progress * 100).toFixed(1)}%, F1: ${c.targetingF1.toFixed(3)}
Concentration: ${c.hitConcentration.toFixed(2)} (max row hits: ${c.maxRowHits}, max col hits: ${c.maxColHits})
${simHistoryStr}${prevQStr}

Think budget: ${d.simBudget} remaining. shouldAct: ${c.shouldAct}

Actions:
  think(cellId) — simulate shooting this cell. Free. ${d.simBudget} left.
  shoot(cellId) — fire. Uses 1 shot. Irreversible.
  ask(text) — ask Spotter yes/no. Uses 1 question.

Reply JSON: {"action":"think","cellId":"D5"} or {"action":"shoot","cellId":"D6"} or {"action":"ask","text":"Is there a ship in row D?"}

Strategy: think about promising cells first, then shoot the best one.
Adjacent to hits = likely ship. Concentrate on rows/cols with hits.`;
}

export interface MPDecision {
  action: "think" | "shoot" | "ask";
  cellId?: string;
  text?: string;
}

export function parseMPDecision(response: string): MPDecision | null {
  try {
    // Try direct JSON parse
    const obj = JSON.parse(response);
    if (obj.action) return obj as MPDecision;
  } catch { /* try regex */ }

  // Try to extract JSON from response
  const match = response.match(/\{[^}]*"action"\s*:\s*"[^"]+?"[^}]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as MPDecision;
    } catch { /* give up */ }
  }

  return null;
}
