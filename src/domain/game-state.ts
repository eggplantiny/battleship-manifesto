/**
 * GameState: The full board grid that lives outside MEL.
 *
 * MEL tracks counters/phase. This holds cells, ships, questions.
 * Effect handlers read/write this state.
 */
import type { Board, Cell, Ship } from "./types.js";
import { cellId } from "./types.js";

export interface QuestionRecord {
  id: string;
  text: string;
  answer: boolean | null;
  turnAsked: number;
}

export class GameState {
  cells: Map<string, Cell>;
  ships: Map<string, Ship>;
  questions: Map<string, QuestionRecord> = new Map();

  constructor(board: Board) {
    this.cells = new Map();
    for (const cell of board.cells) {
      const id = cellId(cell.row, cell.col);
      this.cells.set(id, { ...cell });
    }

    this.ships = new Map();
    for (const ship of board.ships) {
      this.ships.set(ship.id, { ...ship });
    }
  }

  getCell(id: string): Cell | undefined {
    return this.cells.get(id);
  }

  getHitCount(): number {
    let count = 0;
    for (const cell of this.cells.values()) {
      if (cell.status === "hit") count++;
    }
    return count;
  }

  getMissCount(): number {
    let count = 0;
    for (const cell of this.cells.values()) {
      if (cell.status === "miss") count++;
    }
    return count;
  }

  getUnknownCells(): Cell[] {
    const result: Cell[] = [];
    for (const cell of this.cells.values()) {
      if (cell.status === "unknown") result.push(cell);
    }
    return result;
  }

  getRevealedCellIndices(): Set<number> {
    const revealed = new Set<number>();
    for (const cell of this.cells.values()) {
      if (cell.status !== "unknown") {
        revealed.add(cell.index);
      }
    }
    return revealed;
  }

  allShipsSunk(): boolean {
    for (const ship of this.ships.values()) {
      if (!ship.sunk) return false;
    }
    return true;
  }

  /** Add a question record */
  addQuestion(id: string, text: string, turnAsked: number): void {
    this.questions.set(id, { id, text, answer: null, turnAsked });
  }

  /** Record answer for a question */
  answerQuestion(id: string, answer: boolean): void {
    const q = this.questions.get(id);
    if (q) q.answer = answer;
  }

  /** Get ASCII representation of current board state (Captain's view) */
  toAscii(): string {
    const lines: string[] = [];
    lines.push("  1 2 3 4 5 6 7 8");
    const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    for (let r = 0; r < 8; r++) {
      let line = `${rowLabels[r]} `;
      for (let c = 0; c < 8; c++) {
        const id = cellId(r, c);
        const cell = this.cells.get(id)!;
        switch (cell.status) {
          case "hit": line += "X "; break;
          case "miss": line += "O "; break;
          default: line += "- "; break;
        }
      }
      lines.push(line);
    }

    return lines.join("\n");
  }

  /** Get ASCII with ships revealed */
  toAsciiRevealed(): string {
    const lines: string[] = [];
    lines.push("  1 2 3 4 5 6 7 8");
    const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    for (let r = 0; r < 8; r++) {
      let line = `${rowLabels[r]} `;
      for (let c = 0; c < 8; c++) {
        const id = cellId(r, c);
        const cell = this.cells.get(id)!;
        line += cell.hasShip ? "S " : ". ";
      }
      lines.push(line);
    }

    return lines.join("\n");
  }
}
