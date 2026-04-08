import type { ManifestoBridge } from "./bridge.js";
import { BOARD_SIZE, cellIdToIndex, indexToCellId } from "../domain/types.js";

export interface WorldCellState {
  id: string;
  status: string;
}

export function readWorldCells(bridge: ManifestoBridge): WorldCellState[] {
  const cells = bridge.data.cells;
  if (!Array.isArray(cells)) {
    return [];
  }
  return cells.filter(isWorldCellState);
}

export function getHitFrontierCellIds(bridge: ManifestoBridge): Set<string> {
  const cells = readWorldCells(bridge);
  const statusById = new Map(cells.map((cell) => [cell.id, cell.status]));
  const frontier = new Set<string>();

  for (const cell of cells) {
    if (cell.status !== "hit") {
      continue;
    }
    for (const neighborId of getOrthogonalNeighborIds(cell.id)) {
      if (statusById.get(neighborId) === "unknown") {
        frontier.add(neighborId);
      }
    }
  }

  return frontier;
}

function getOrthogonalNeighborIds(cellId: string): string[] {
  const index = cellIdToIndex(cellId);
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const neighbors: string[] = [];

  if (row > 0) neighbors.push(indexToCellId(index - BOARD_SIZE));
  if (row < BOARD_SIZE - 1) neighbors.push(indexToCellId(index + BOARD_SIZE));
  if (col > 0) neighbors.push(indexToCellId(index - 1));
  if (col < BOARD_SIZE - 1) neighbors.push(indexToCellId(index + 1));

  return neighbors;
}

function isWorldCellState(value: unknown): value is WorldCellState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const cell = value as Record<string, unknown>;
  return typeof cell.id === "string" && typeof cell.status === "string";
}
