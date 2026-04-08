/**
 * 18 pre-sampled boards (B01-B18).
 * Generated with deterministic seeds. In future, replace with Gabe's actual boards.
 */
import { generateBoard } from "./generator.js";
import type { Board } from "../domain/types.js";

const BOARD_SEEDS: Record<string, number> = {
  B01: 1001, B02: 1002, B03: 1003, B04: 1004, B05: 1005, B06: 1006,
  B07: 1007, B08: 1008, B09: 1009, B10: 1010, B11: 1011, B12: 1012,
  B13: 1013, B14: 1014, B15: 1015, B16: 1016, B17: 1017, B18: 1018,
};

const boardCache = new Map<string, Board>();

export function loadBoard(boardId: string): Board {
  const cached = boardCache.get(boardId);
  if (cached) return cached;

  const seed = BOARD_SEEDS[boardId];
  if (seed === undefined) {
    throw new Error(`Unknown board: ${boardId}`);
  }

  const board = generateBoard(seed);
  boardCache.set(boardId, board);
  return board;
}

export function getAllBoardIds(): string[] {
  return Object.keys(BOARD_SEEDS);
}
