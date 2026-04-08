/** 8×8 Battleship board cell */
export interface Cell {
  index: number;
  row: number;
  col: number;
  hasShip: boolean;
  shipId: string | null;
  status: "unknown" | "hit" | "miss";
}

/** Ship placed on the board */
export interface Ship {
  id: string;
  size: number;
  color: "red" | "green" | "purple" | "orange";
  hitCount: number;
  sunk: boolean;
}

/** Question asked by Captain */
export interface Question {
  id: string;
  text: string;
  answer: boolean | null;
  turnAsked: number;
}

/** Full board state (ground truth — Spotter's view) */
export interface Board {
  cells: Cell[];
  ships: Ship[];
}

/** Board snapshot data as seen in Manifesto snapshot */
export interface BattleshipState {
  cells: Record<string, Cell>;
  ships: Record<string, Ship>;
  totalShipCells: number;
  turnNumber: number;
  shotsRemaining: number;
  questionsRemaining: number;
  shotsFired: number;
  questionsAsked: number;
  phase: "setup" | "playing" | "won" | "lost";
  questions: Record<string, Question>;
  lastQuestionId: string | null;
  lastShotCellId: string | null;
  lastShotResult: "hit" | "miss" | null;
}

/** Computed values from MEL */
export interface BattleshipComputed {
  hitCount: number;
  missCount: number;
  unknownCount: number;
  shipCellsRemaining: number;
  allShipsSunk: boolean;
  hitRate: number;
  progress: number;
  targetingPrecision: number;
  targetingRecall: number;
  targetingF1: number;
}

/** Ship configuration for the game */
export const SHIP_CONFIG = [
  { size: 5, color: "red" as const },
  { size: 4, color: "green" as const },
  { size: 3, color: "purple" as const },
  { size: 2, color: "orange" as const },
] as const;

export const BOARD_SIZE = 8;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE; // 64
export const TOTAL_SHIP_CELLS = SHIP_CONFIG.reduce((sum, s) => sum + s.size, 0); // 14
export const MAX_SHOTS = 40;
export const MAX_QUESTIONS = 15;

/** Row labels A-H */
export const ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/** Convert row/col to cell ID (e.g., "A1", "H8") */
export function cellId(row: number, col: number): string {
  return `${ROW_LABELS[row]}${col + 1}`;
}

/** Convert cell index (0-63) to cell ID */
export function indexToCellId(index: number): string {
  return cellId(Math.floor(index / BOARD_SIZE), index % BOARD_SIZE);
}

/** Convert cell ID to index */
export function cellIdToIndex(id: string): number {
  const row = ROW_LABELS.indexOf(id[0] as (typeof ROW_LABELS)[number]);
  const col = parseInt(id.slice(1), 10) - 1;
  return row * BOARD_SIZE + col;
}
