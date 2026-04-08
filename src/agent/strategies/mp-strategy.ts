/**
 * MP Strategy: LLM-driven planning with think/shoot/ask.
 *
 * MEL source as system prompt. Conversation history persists across turns.
 * think() → recordSimResult() → confident → shoot/ask.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Strategy, TurnContext, TurnDecision } from "./strategy.js";
import type { LLMClient, ChatMessage } from "../llm/client.js";
import { evaluateCell, computePHit } from "../core/simulation.js";
import { indexToCellId, cellIdToIndex, TOTAL_CELLS } from "../../domain/types.js";
import { resolveQuestionDescriptor } from "../questions/template-questions.js";

export class MPStrategy implements Strategy {
  name = "mp";
  private chatHistory: ChatMessage[] = [];
  private initialized = false;

  constructor(private llm: LLMClient) {}

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    // System prompt once
    if (!this.initialized) {
      const mel = readFileSync(resolve(import.meta.dirname, "../../domain/battleship-mp.mel"), "utf-8");
      const edges = ctx.bridge.schemaGraph.edges
        .map((e: any) => `${e.from} -[${e.relation}]-> ${e.to}`)
        .join("\n");
      this.chatHistory.push({
        role: "system",
        content: `You are an agent running on this MEL domain. This is your source code:\n\n${mel}\n\nCausal graph:\n${edges}\n\nYou choose actions each turn. Reply with ONLY the action, e.g.:\nthink D5\nshoot D6\naskQuestion "Is there a ship in row D?"`,
      });
      this.initialized = true;
    }

    await ctx.bridge.dispatch("startTurn");
    const turnThoughts: string[] = [];

    // Inner think loop
    for (let iter = 0; iter < 20; iter++) {
      const userMsg = this.buildUserMessage(ctx, turnThoughts);
      this.chatHistory.push({ role: "user", content: userMsg });

      let response: string;
      try {
        response = await this.llm.chat(this.chatHistory);
      } catch {
        return this.forceShoot(ctx, turnThoughts);
      }
      this.chatHistory.push({ role: "assistant", content: response.trim() });

      const parsed = this.parseResponse(response, ctx.bridge.availableActions);
      if (!parsed) return this.forceShoot(ctx, turnThoughts);

      // Think
      if (parsed.action === "think" && parsed.arg) {
        if (turnThoughts.includes(parsed.arg)) {
          this.chatHistory.push({ role: "user", content: `Already thought about ${parsed.arg}. Try another cell.` });
          continue;
        }
        await ctx.bridge.dispatch("think",parsed.arg);
        const sim = evaluateCell(ctx.bridge, parsed.arg, cellIdToIndex(parsed.arg), ctx.particles);
        await ctx.bridge.dispatch("recordSimResult",parsed.arg, sim.hitProb, sim.boardValue);
        turnThoughts.push(parsed.arg);
        this.chatHistory.push({ role: "user", content: `think ${parsed.arg} → hitProb=${sim.hitProb.toFixed(2)}, boardValue=${sim.boardValue.toFixed(3)}` });
        console.log(`  [MP] think ${parsed.arg} → hitProb=${sim.hitProb.toFixed(2)}`);
        continue;
      }

      // Shoot
      if (parsed.action === "shoot" && parsed.arg) {
        const revealed = ctx.gameState.getRevealedCellIndices();
        const idx = cellIdToIndex(parsed.arg);
        if (idx >= 0 && idx < TOTAL_CELLS && !revealed.has(idx)) {
          await ctx.bridge.dispatch("commitAction");
          console.log(`  [MP] shoot ${parsed.arg}`);
          return { action: "shoot", cellId: parsed.arg };
        }
        this.chatHistory.push({ role: "user", content: `${parsed.arg} already revealed. Pick another.` });
        continue;
      }

      // Ask question
      if (parsed.action === "askQuestion" && parsed.arg) {
        await ctx.bridge.dispatch("commitAction");
        console.log(`  [MP] ask "${parsed.arg}"`);
        const question = resolveQuestionDescriptor(parsed.arg, this.buildEvaluate(parsed.arg));
        ctx.askedQuestions.add(question.id);
        return {
          action: "question",
          questionId: question.id,
          questionText: question.text,
          evaluate: question.evaluate,
        };
      }
    }

    return this.forceShoot(ctx, turnThoughts);
  }

  private buildUserMessage(ctx: TurnContext, thoughts: string[]): string {
    const d = ctx.bridge.data;
    const c = ctx.bridge.computed;
    const board = ctx.gameState.toAscii();
    const available = ctx.bridge.availableActions.filter(
      (a: string) => a === "think" || a === "shoot" || a === "askQuestion",
    );

    let simStr = "";
    if (thoughts.length > 0) simStr = `\nThoughts: ${thoughts.join(", ")}`;

    return `${board}\ndata: ${JSON.stringify(d)}\ncomputed: ${JSON.stringify(c)}${simStr}\navailable: ${available.join(", ")}`;
  }

  private parseResponse(response: string, available: string[]): { action: string; arg?: string } | null {
    const line = response.trim().split("\n")[0].trim();
    const thinkMatch = line.match(/think\s+([A-Ha-h]\d)/i);
    if (thinkMatch) return { action: "think", arg: thinkMatch[1].toUpperCase() };
    const shootMatch = line.match(/shoot\s+([A-Ha-h]\d)/i);
    if (shootMatch) return { action: "shoot", arg: shootMatch[1].toUpperCase() };
    const askMatch = line.match(/askQuestion\s+"?([^"]+)"?/i);
    if (askMatch) return { action: "askQuestion", arg: askMatch[1] };
    return null;
  }

  private async forceShoot(ctx: TurnContext, thoughts: string[]): Promise<TurnDecision> {
    // Auto-think top cells until confident
    const revealed = ctx.gameState.getRevealedCellIndices();
    const cells: { index: number; pHit: number }[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) {
      if (revealed.has(i)) continue;
      cells.push({ index: i, pHit: computePHit(i, ctx.particles) });
    }
    cells.sort((a, b) => b.pHit - a.pHit);

    for (const cell of cells.slice(0, 5)) {
      const cellId = indexToCellId(cell.index);
      if (thoughts.includes(cellId)) continue;
      try {
        await ctx.bridge.dispatch("think",cellId);
        const sim = evaluateCell(ctx.bridge, cellId, cell.index, ctx.particles);
        await ctx.bridge.dispatch("recordSimResult",cellId, sim.hitProb, sim.boardValue);
        const snap = ctx.bridge.snapshot;
        if ((snap.computed as any).confident) break;
      } catch { break; }
    }

    await ctx.bridge.dispatch("commitAction");
    const bestCell = (ctx.bridge.data.bestSimCell as string) || indexToCellId(cells[0]?.index ?? 0);
    return { action: "shoot", cellId: bestCell };
  }

  private buildEvaluate(text: string): (board: any) => boolean {
    const lower = text.toLowerCase();
    const rowMatch = lower.match(/row\s+([a-h])/);
    if (rowMatch) {
      const rowIdx = rowMatch[1].charCodeAt(0) - "a".charCodeAt(0);
      return (board: any) => board.cells.some((c: any) => c.row === rowIdx && c.hasShip);
    }
    const colMatch = lower.match(/column\s+(\d)/);
    if (colMatch) {
      const colIdx = parseInt(colMatch[1], 10) - 1;
      return (board: any) => board.cells.some((c: any) => c.col === colIdx && c.hasShip);
    }
    return () => false;
  }
}
