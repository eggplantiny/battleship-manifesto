import {
  type Board,
  type Cell,
  type Ship,
  BOARD_SIZE,
  SHIP_CONFIG,
  cellId,
} from "../domain/types.js";

/** Simple seeded PRNG (xorshift32) */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 1;
  }

  /** Returns a number in [0, 1) */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 4294967296;
  }

  /** Returns an integer in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

/** Generate a random valid board with seeded PRNG */
export function generateBoard(seed: number): Board {
  const rng = new SeededRandom(seed);
  const grid: boolean[] = new Array(BOARD_SIZE * BOARD_SIZE).fill(false);
  const shipOwner: (string | null)[] = new Array(BOARD_SIZE * BOARD_SIZE).fill(null);
  const ships: Ship[] = [];

  for (const config of SHIP_CONFIG) {
    const shipId = `ship_${config.color}`;
    let placed = false;

    for (let attempt = 0; attempt < 1000; attempt++) {
      const horizontal = rng.next() < 0.5;
      const maxRow = horizontal ? BOARD_SIZE : BOARD_SIZE - config.size;
      const maxCol = horizontal ? BOARD_SIZE - config.size : BOARD_SIZE;
      const row = rng.nextInt(maxRow);
      const col = rng.nextInt(maxCol);

      const indices: number[] = [];
      let valid = true;

      for (let i = 0; i < config.size; i++) {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        const idx = r * BOARD_SIZE + c;

        if (grid[idx]) {
          valid = false;
          break;
        }
        indices.push(idx);
      }

      if (valid) {
        for (const idx of indices) {
          grid[idx] = true;
          shipOwner[idx] = shipId;
        }
        ships.push({
          id: shipId,
          size: config.size,
          color: config.color,
          hitCount: 0,
          sunk: false,
        });
        placed = true;
        break;
      }
    }

    if (!placed) {
      throw new Error(`Failed to place ${config.color} ship (size ${config.size})`);
    }
  }

  const cells: Cell[] = [];
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const row = Math.floor(i / BOARD_SIZE);
    const col = i % BOARD_SIZE;
    cells.push({
      index: i,
      row,
      col,
      hasShip: grid[i],
      shipId: shipOwner[i],
      status: "unknown",
    });
  }

  return { cells, ships };
}

/** Convert Board to Manifesto state format (Record-based) */
export function boardToStateRecords(board: Board): {
  cells: Record<string, Cell>;
  ships: Record<string, Ship>;
} {
  const cells: Record<string, Cell> = {};
  for (const cell of board.cells) {
    const id = cellId(cell.row, cell.col);
    cells[id] = { ...cell };
  }

  const ships: Record<string, Ship> = {};
  for (const ship of board.ships) {
    ships[ship.id] = { ...ship };
  }

  return { cells, ships };
}

/** Print board as ASCII grid for debugging */
export function boardToAscii(board: Board, revealAll = false): string {
  const lines: string[] = [];
  lines.push("  1 2 3 4 5 6 7 8");

  const rowLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (let r = 0; r < BOARD_SIZE; r++) {
    let line = `${rowLabels[r]} `;
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board.cells[r * BOARD_SIZE + c];
      if (revealAll) {
        line += cell.hasShip ? "S " : ". ";
      } else {
        switch (cell.status) {
          case "hit":
            line += "X ";
            break;
          case "miss":
            line += "O ";
            break;
          default:
            line += "- ";
        }
      }
    }
    lines.push(line);
  }

  return lines.join("\n");
}
