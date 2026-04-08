import type { ManifestoBridge } from "./bridge.js";
import type { BeliefState } from "../belief/belief-state.js";
import { BOARD_SIZE, TOTAL_CELLS, cellId, indexToCellId } from "../domain/types.js";
import type { QuestionDescriptor } from "../questions/template-questions.js";
import { getQuestionRegionCellIds } from "../questions/template-questions.js";
import { readWorldCells } from "./world-frontier.js";

export interface WorldHitCluster {
  cellIds: string[];
}

export interface WorldBeliefSummary {
  bestHitProb: number;
  frontierCellIds: Set<string>;
  frontierCount: number;
  hitClusters: WorldHitCluster[];
  largestHitClusterSize: number;
  cellMass: Map<string, number>;
  rowMass: number[];
  columnMass: number[];
  quadrantMass: Map<string, number>;
  blockMass: Map<string, number>;
}

export interface SalvageQuestionScore {
  rawValue: number;
  adjustedValue: number;
  pYes: number;
  splitQuality: number;
  regionMass: number;
  clusterRelevance: number;
}

export interface CoarseQuestionScore {
  rawValue: number;
  adjustedValue: number;
  pYes: number;
  splitQuality: number;
  regionMass: number;
}

export function computeWorldBeliefSummary(
  bridge: ManifestoBridge,
  particles: BeliefState,
  bestHitProb: number,
): WorldBeliefSummary {
  const cells = readWorldCells(bridge);
  const unknownIds = new Set(cells.filter((cell) => cell.status === "unknown").map((cell) => cell.id));
  const frontierCellIds = computeFrontierCellIds(cells);
  const hitClusters = computeHitClusters(cells);
  const cellMass = new Map<string, number>();
  const rowMass = Array.from({ length: BOARD_SIZE }, () => 0);
  const columnMass = Array.from({ length: BOARD_SIZE }, () => 0);
  const quadrantMass = new Map<string, number>();
  const blockMass = new Map<string, number>();

  for (const sample of particles.samples) {
    for (let cellIndex = 0; cellIndex < TOTAL_CELLS; cellIndex++) {
      const worldCellId = indexToCellId(cellIndex);
      if (!unknownIds.has(worldCellId)) {
        continue;
      }
      if (!sample.board.cells[cellIndex].hasShip) {
        continue;
      }

      const weight = sample.weight;
      cellMass.set(worldCellId, (cellMass.get(worldCellId) ?? 0) + weight);
      const row = Math.floor(cellIndex / BOARD_SIZE);
      const column = cellIndex % BOARD_SIZE;
      rowMass[row] += weight;
      columnMass[column] += weight;

      const quadrantId = getQuadrantId(row, column);
      quadrantMass.set(quadrantId, (quadrantMass.get(quadrantId) ?? 0) + weight);

      const blockId = getBlockId(row, column);
      blockMass.set(blockId, (blockMass.get(blockId) ?? 0) + weight);
    }
  }

  return {
    bestHitProb,
    frontierCellIds,
    frontierCount: frontierCellIds.size,
    hitClusters,
    largestHitClusterSize: hitClusters.reduce((best, cluster) => Math.max(best, cluster.cellIds.length), 0),
    cellMass,
    rowMass,
    columnMass,
    quadrantMass,
    blockMass,
  };
}

export function scoreSalvageQuestion(
  summary: WorldBeliefSummary,
  question: QuestionDescriptor,
  rawValue: number,
  pYes: number,
): SalvageQuestionScore {
  const splitQuality = 1 - Math.abs((2 * pYes) - 1);
  const regionCellIds = question.regionCellIds ?? getQuestionRegionCellIds(question.id);
  const regionMass = computeRegionMass(summary, question.id, regionCellIds);
  const clusterRelevance = computeClusterRelevance(summary, regionCellIds);

  const adjustedValue = rawValue +
    (0.03 * splitQuality) +
    (0.035 * regionMass) +
    (0.025 * clusterRelevance);

  return {
    rawValue,
    adjustedValue,
    pYes,
    splitQuality,
    regionMass,
    clusterRelevance,
  };
}

export function scoreCoarseQuestion(
  summary: WorldBeliefSummary,
  question: QuestionDescriptor,
  rawValue: number,
  pYes: number,
): CoarseQuestionScore {
  const splitQuality = 1 - Math.abs((2 * pYes) - 1);
  const regionCellIds = question.regionCellIds ?? getQuestionRegionCellIds(question.id);
  const regionMass = computeRegionMass(summary, question.id, regionCellIds);
  const adjustedValue = rawValue +
    (0.015 * splitQuality) +
    (0.005 * regionMass);

  return {
    rawValue,
    adjustedValue,
    pYes,
    splitQuality,
    regionMass,
  };
}

function computeRegionMass(
  summary: WorldBeliefSummary,
  questionId: string,
  regionCellIds: string[],
): number {
  if (questionId.startsWith("row:")) {
    const rowLabel = questionId.slice("row:".length);
    const row = rowLabel.charCodeAt(0) - "A".charCodeAt(0);
    return normalizeMass(summary.rowMass[row] ?? 0, 8);
  }

  if (questionId.startsWith("column:")) {
    const column = Number.parseInt(questionId.slice("column:".length), 10) - 1;
    return normalizeMass(summary.columnMass[column] ?? 0, 8);
  }

  if (questionId.startsWith("quadrant:")) {
    return normalizeMass(summary.quadrantMass.get(questionId) ?? 0, 16);
  }

  if (questionId.startsWith("block-2x2:")) {
    return normalizeMass(summary.blockMass.get(questionId) ?? 0, 4);
  }

  const mass = regionCellIds.reduce(
    (total, cellIdValue) => total + (summary.cellMass.get(cellIdValue) ?? 0),
    0,
  );

  return normalizeMass(mass, Math.max(regionCellIds.length, 1));
}

function computeClusterRelevance(
  summary: WorldBeliefSummary,
  regionCellIds: string[],
): number {
  if (summary.hitClusters.length === 0 || regionCellIds.length === 0) {
    return 0;
  }

  const regionRows = new Set<number>();
  const regionColumns = new Set<number>();
  for (const regionCellId of regionCellIds) {
    const index = cellIdToGridIndex(regionCellId);
    regionRows.add(index.row);
    regionColumns.add(index.column);
  }

  let bestRelevance = 0;
  for (const cluster of summary.hitClusters) {
    const clusterRows = new Set<number>();
    const clusterColumns = new Set<number>();
    for (const clusterCellId of cluster.cellIds) {
      const index = cellIdToGridIndex(clusterCellId);
      clusterRows.add(index.row);
      clusterColumns.add(index.column);
    }

    const rowOverlap = countSetOverlap(regionRows, clusterRows);
    const columnOverlap = countSetOverlap(regionColumns, clusterColumns);
    const overlap = Math.max(rowOverlap, columnOverlap);
    const normalized = overlap / Math.max(Math.max(clusterRows.size, clusterColumns.size), 1);
    bestRelevance = Math.max(bestRelevance, normalized);
  }

  return bestRelevance;
}

function computeFrontierCellIds(cells: ReturnType<typeof readWorldCells>): Set<string> {
  const statusById = new Map(cells.map((cell) => [cell.id, cell.status]));
  const frontier = new Set<string>();

  for (const cell of cells) {
    if (cell.status !== "hit") continue;
    for (const neighborId of getOrthogonalNeighborIds(cell.id)) {
      if (statusById.get(neighborId) === "unknown") {
        frontier.add(neighborId);
      }
    }
  }

  return frontier;
}

function computeHitClusters(cells: ReturnType<typeof readWorldCells>): WorldHitCluster[] {
  const hitIds = new Set(cells.filter((cell) => cell.status === "hit").map((cell) => cell.id));
  const remaining = new Set(hitIds);
  const clusters: WorldHitCluster[] = [];

  while (remaining.size > 0) {
    const [start] = remaining;
    const queue = [start];
    remaining.delete(start);
    const cellIds: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      cellIds.push(current);
      for (const neighborId of getOrthogonalNeighborIds(current)) {
        if (remaining.has(neighborId)) {
          remaining.delete(neighborId);
          queue.push(neighborId);
        }
      }
    }

    clusters.push({ cellIds });
  }

  return clusters;
}

function getQuadrantId(row: number, column: number): string {
  if (row < 4 && column < 4) return "quadrant:top-left";
  if (row < 4) return "quadrant:top-right";
  if (column < 4) return "quadrant:bottom-left";
  return "quadrant:bottom-right";
}

function getBlockId(row: number, column: number): string {
  const topLeftRow = Math.max(0, Math.min(row, BOARD_SIZE - 2));
  const topLeftColumn = Math.max(0, Math.min(column, BOARD_SIZE - 2));
  return `block-2x2:${cellId(topLeftRow, topLeftColumn)}-${cellId(topLeftRow + 1, topLeftColumn + 1)}`;
}

function getOrthogonalNeighborIds(cellIdValue: string): string[] {
  const { row, column } = cellIdToGridIndex(cellIdValue);
  const neighbors: string[] = [];

  if (row > 0) neighbors.push(cellId(row - 1, column));
  if (row < BOARD_SIZE - 1) neighbors.push(cellId(row + 1, column));
  if (column > 0) neighbors.push(cellId(row, column - 1));
  if (column < BOARD_SIZE - 1) neighbors.push(cellId(row, column + 1));

  return neighbors;
}

function cellIdToGridIndex(cellIdValue: string): { row: number; column: number } {
  const row = cellIdValue.charCodeAt(0) - "A".charCodeAt(0);
  const column = Number.parseInt(cellIdValue.slice(1), 10) - 1;
  return { row, column };
}

function normalizeMass(rawMass: number, maxCells: number): number {
  return Math.max(0, Math.min(1, rawMass / Math.max(maxCells, 1)));
}

function countSetOverlap<T>(left: Set<T>, right: Set<T>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count++;
  }
  return count;
}
