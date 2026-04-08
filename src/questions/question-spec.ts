import type { Board } from "../domain/types.js";
import { BOARD_SIZE, ROW_LABELS, cellId, cellIdToIndex, indexToCellId } from "../domain/types.js";
import type { QuestionDescriptor } from "./template-questions.js";
import type { WorldBeliefSummary, WorldHitCluster } from "../runtime/world-belief-summary.js";
import type { WorldCellState } from "../runtime/world-frontier.js";

export type QuestionPredicate = "exists_ship";
export type QuestionRegionKind =
  | "row"
  | "column"
  | "quadrant"
  | "row_band_2"
  | "column_band_2"
  | "block_2x2"
  | "frontier_ring"
  | "cluster_neighborhood";

export type QuestionSpec =
  | {
      predicate: "exists_ship";
      region: { kind: "row"; row: string };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "column"; column: number };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "quadrant"; quadrant: QuadrantName };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "row_band_2"; startRow: string };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "column_band_2"; startColumn: number };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "block_2x2"; anchor: string };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "frontier_ring"; anchor: string; radius?: 1 | 2 };
    }
  | {
      predicate: "exists_ship";
      region: { kind: "cluster_neighborhood"; anchor: string; depth?: 1 | 2 };
    };

export type QuadrantName = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface QuestionCompileContext {
  worldCells: WorldCellState[];
  frontierCellIds: Iterable<string>;
  hitClusters: WorldHitCluster[];
  askedQuestions?: Set<string>;
}

export interface SynthesizedQuestionDescriptor extends QuestionDescriptor {
  readonly source: "synthesized";
  readonly questionSpec: QuestionSpec;
  readonly regionCellIds: string[];
}

export interface QuestionSpecCompileSuccess {
  ok: true;
  descriptor: SynthesizedQuestionDescriptor;
}

export interface QuestionSpecCompileFailure {
  ok: false;
  code:
    | "INVALID_SPEC"
    | "UNSUPPORTED_PREDICATE"
    | "INVALID_REGION"
    | "OUT_OF_RANGE"
    | "UNKNOWN_ANCHOR"
    | "EMPTY_REGION"
    | "DUPLICATE_QUESTION";
  message: string;
}

export type QuestionSpecCompileResult = QuestionSpecCompileSuccess | QuestionSpecCompileFailure;

const QUADRANT_NAMES: readonly QuadrantName[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export function parseQuestionSpec(value: unknown): QuestionSpec | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.predicate !== "exists_ship") {
    return null;
  }

  const region = candidate.region;
  if (!region || typeof region !== "object") {
    return null;
  }

  const regionRecord = region as Record<string, unknown>;
  switch (regionRecord.kind) {
    case "row":
      return typeof regionRecord.row === "string"
        ? { predicate: "exists_ship", region: { kind: "row", row: regionRecord.row } }
        : null;
    case "column":
      return typeof regionRecord.column === "number"
        ? { predicate: "exists_ship", region: { kind: "column", column: regionRecord.column } }
        : null;
    case "quadrant":
      return typeof regionRecord.quadrant === "string" && QUADRANT_NAMES.includes(regionRecord.quadrant as QuadrantName)
        ? { predicate: "exists_ship", region: { kind: "quadrant", quadrant: regionRecord.quadrant as QuadrantName } }
        : null;
    case "row_band_2":
      return typeof regionRecord.startRow === "string"
        ? { predicate: "exists_ship", region: { kind: "row_band_2", startRow: regionRecord.startRow } }
        : null;
    case "column_band_2":
      return typeof regionRecord.startColumn === "number"
        ? { predicate: "exists_ship", region: { kind: "column_band_2", startColumn: regionRecord.startColumn } }
        : null;
    case "block_2x2":
      return typeof regionRecord.anchor === "string"
        ? { predicate: "exists_ship", region: { kind: "block_2x2", anchor: regionRecord.anchor } }
        : null;
    case "frontier_ring":
      return typeof regionRecord.anchor === "string" &&
          (regionRecord.radius === undefined || regionRecord.radius === 1 || regionRecord.radius === 2)
        ? {
            predicate: "exists_ship",
            region: {
              kind: "frontier_ring",
              anchor: regionRecord.anchor,
              radius: regionRecord.radius as 1 | 2 | undefined,
            },
          }
        : null;
    case "cluster_neighborhood":
      return typeof regionRecord.anchor === "string" &&
          (regionRecord.depth === undefined || regionRecord.depth === 1 || regionRecord.depth === 2)
        ? {
            predicate: "exists_ship",
            region: {
              kind: "cluster_neighborhood",
              anchor: regionRecord.anchor,
              depth: regionRecord.depth as 1 | 2 | undefined,
            },
          }
        : null;
    default:
      return null;
  }
}

export function compileQuestionSpec(
  spec: QuestionSpec,
  context: QuestionCompileContext,
): QuestionSpecCompileResult {
  if (spec.predicate !== "exists_ship") {
    return failure("UNSUPPORTED_PREDICATE", `Unsupported predicate: ${String(spec.predicate)}`);
  }

  const region = buildRegion(spec, context);
  if (!region.ok) {
    return region;
  }

  const askedQuestions = context.askedQuestions;
  if (askedQuestions?.has(region.id)) {
    return failure("DUPLICATE_QUESTION", `Question already asked: ${region.id}`);
  }

  const regionCellIds = dedupeAndSortCellIds(region.regionCellIds);
  if (regionCellIds.length === 0) {
    return failure("EMPTY_REGION", "Compiled question region is empty");
  }

  const regionIndexes = regionCellIds.map((questionCellId) => cellIdToIndex(questionCellId));

  return {
    ok: true,
    descriptor: {
      id: region.id,
      family: region.family,
      text: region.text,
      source: "synthesized",
      questionSpec: spec,
      regionCellIds,
      evaluate: (board: Board) => regionIndexes.some((index) => board.cells[index]?.hasShip === true),
    },
  };
}

export function formatQuestionSpecGrammar(summary: WorldBeliefSummary): string {
  const clusterAnchors = unique(
    summary.hitClusters.flatMap((cluster) => cluster.cellIds),
  ).slice(0, 8);
  const frontierAnchors = [...summary.frontierCellIds].slice(0, 8);

  return [
    "Allowed synthesized question grammar:",
    '- {"predicate":"exists_ship","region":{"kind":"row","row":"A"}}',
    '- {"predicate":"exists_ship","region":{"kind":"column","column":1}}',
    '- {"predicate":"exists_ship","region":{"kind":"quadrant","quadrant":"top-left"}}',
    '- {"predicate":"exists_ship","region":{"kind":"row_band_2","startRow":"D"}}',
    '- {"predicate":"exists_ship","region":{"kind":"column_band_2","startColumn":3}}',
    '- {"predicate":"exists_ship","region":{"kind":"block_2x2","anchor":"D5"}}',
    '- {"predicate":"exists_ship","region":{"kind":"frontier_ring","anchor":"E6","radius":1}}',
    '- {"predicate":"exists_ship","region":{"kind":"cluster_neighborhood","anchor":"E6","depth":1}}',
    `Cluster anchors: ${clusterAnchors.length > 0 ? clusterAnchors.join(", ") : "(none)"}`,
    `Frontier anchors: ${frontierAnchors.length > 0 ? frontierAnchors.join(", ") : "(none)"}`,
    "Use only radius/depth 1 or 2. Use a legal on-board anchor.",
  ].join("\n");
}

function buildRegion(
  spec: QuestionSpec,
  context: QuestionCompileContext,
): QuestionSpecCompileResult | {
  ok: true;
  id: string;
  family: QuestionDescriptor["family"];
  text: string;
  regionCellIds: string[];
} {
  switch (spec.region.kind) {
    case "row": {
      const row = normalizeRowLabel(spec.region.row);
      if (!row) {
        return failure("INVALID_REGION", `Invalid row label: ${spec.region.row}`);
      }
      const rowIndex = rowLabelToIndex(row);
      return {
        ok: true,
        id: `row:${row}`,
        family: "row",
        text: `Is there a ship in row ${row}?`,
        regionCellIds: Array.from({ length: BOARD_SIZE }, (_, column) => cellId(rowIndex, column)),
      };
    }
    case "column": {
      const column = normalizeColumnNumber(spec.region.column);
      if (column === null) {
        return failure("INVALID_REGION", `Invalid column: ${String(spec.region.column)}`);
      }
      return {
        ok: true,
        id: `column:${column}`,
        family: "column",
        text: `Is there a ship in column ${column}?`,
        regionCellIds: Array.from({ length: BOARD_SIZE }, (_, row) => cellId(row, column - 1)),
      };
    }
    case "quadrant": {
      const quadrant = spec.region.quadrant;
      if (!QUADRANT_NAMES.includes(quadrant)) {
        return failure("INVALID_REGION", `Invalid quadrant: ${quadrant}`);
      }
      return {
        ok: true,
        id: `quadrant:${quadrant}`,
        family: "quadrant",
        text: `Is there a ship in the ${quadrant} quadrant?`,
        regionCellIds: getQuadrantCells(quadrant),
      };
    }
    case "row_band_2": {
      const row = normalizeRowLabel(spec.region.startRow);
      if (!row) {
        return failure("INVALID_REGION", `Invalid row band start: ${spec.region.startRow}`);
      }
      const rowIndex = rowLabelToIndex(row);
      if (rowIndex >= BOARD_SIZE - 1) {
        return failure("OUT_OF_RANGE", `row_band_2 startRow must be A-G: ${row}`);
      }
      const nextRow = ROW_LABELS[rowIndex + 1]!;
      return {
        ok: true,
        id: `row-band-2:${row}-${nextRow}`,
        family: "row-band-2",
        text: `Is there a ship in rows ${row}-${nextRow}?`,
        regionCellIds: enumerateRect(rowIndex, rowIndex + 1, 0, BOARD_SIZE - 1),
      };
    }
    case "column_band_2": {
      const startColumn = normalizeColumnNumber(spec.region.startColumn);
      if (startColumn === null || startColumn >= BOARD_SIZE) {
        return failure("OUT_OF_RANGE", `column_band_2 startColumn must be 1-7: ${String(spec.region.startColumn)}`);
      }
      return {
        ok: true,
        id: `column-band-2:${startColumn}-${startColumn + 1}`,
        family: "column-band-2",
        text: `Is there a ship in columns ${startColumn}-${startColumn + 1}?`,
        regionCellIds: enumerateRect(0, BOARD_SIZE - 1, startColumn - 1, startColumn),
      };
    }
    case "block_2x2": {
      const anchor = normalizeCellId(spec.region.anchor);
      if (!anchor) {
        return failure("INVALID_REGION", `Invalid block anchor: ${spec.region.anchor}`);
      }
      const anchorIndex = cellIdToIndex(anchor);
      const row = Math.floor(anchorIndex / BOARD_SIZE);
      const column = anchorIndex % BOARD_SIZE;
      if (row >= BOARD_SIZE - 1 || column >= BOARD_SIZE - 1) {
        return failure("OUT_OF_RANGE", `block_2x2 anchor must be top-left inside board: ${anchor}`);
      }
      return {
        ok: true,
        id: `block-2x2:${anchor}-${cellId(row + 1, column + 1)}`,
        family: "block-2x2",
        text: `Is there a ship in block ${anchor}-${cellId(row + 1, column + 1)}?`,
        regionCellIds: enumerateRect(row, row + 1, column, column + 1),
      };
    }
    case "frontier_ring": {
      const anchor = normalizeCellId(spec.region.anchor);
      if (!anchor) {
        return failure("INVALID_REGION", `Invalid frontier ring anchor: ${spec.region.anchor}`);
      }
      const radius = spec.region.radius ?? 1;
      if (radius !== 1 && radius !== 2) {
        return failure("OUT_OF_RANGE", `frontier_ring radius must be 1 or 2: ${String(radius)}`);
      }
      const allowedAnchors = new Set<string>([
        ...context.hitClusters.flatMap((cluster) => cluster.cellIds),
        ...context.frontierCellIds,
      ]);
      if (!allowedAnchors.has(anchor)) {
        return failure("UNKNOWN_ANCHOR", `frontier_ring anchor not in current hit/frontier state: ${anchor}`);
      }
      const regionCellIds = collectRadiusCells(anchor, radius, context.worldCells);
      if (regionCellIds.length === 0) {
        return failure("EMPTY_REGION", `frontier_ring around ${anchor} produced no unknown cells`);
      }
      return {
        ok: true,
        id: `frontier-ring:${anchor}:r${radius}`,
        family: "frontier-ring",
        text: `Is there a ship in the frontier ring around ${anchor} (radius ${radius})?`,
        regionCellIds,
      };
    }
    case "cluster_neighborhood": {
      const anchor = normalizeCellId(spec.region.anchor);
      if (!anchor) {
        return failure("INVALID_REGION", `Invalid cluster anchor: ${spec.region.anchor}`);
      }
      const depth = spec.region.depth ?? 1;
      if (depth !== 1 && depth !== 2) {
        return failure("OUT_OF_RANGE", `cluster_neighborhood depth must be 1 or 2: ${String(depth)}`);
      }
      const cluster = context.hitClusters.find((candidate) => candidate.cellIds.includes(anchor));
      if (!cluster) {
        return failure("UNKNOWN_ANCHOR", `cluster_neighborhood anchor not in current hit clusters: ${anchor}`);
      }
      const regionCellIds = collectClusterNeighborhoodCells(cluster, depth, context.worldCells);
      if (regionCellIds.length === 0) {
        return failure("EMPTY_REGION", `cluster_neighborhood around ${anchor} produced no unknown cells`);
      }
      return {
        ok: true,
        id: `cluster-neighborhood:${anchor}:d${depth}`,
        family: "cluster-neighborhood",
        text: `Is there a ship in the cluster neighborhood around ${anchor} (depth ${depth})?`,
        regionCellIds,
      };
    }
  }
}

function collectRadiusCells(anchor: string, radius: 1 | 2, worldCells: WorldCellState[]): string[] {
  const statuses = new Map(worldCells.map((cell) => [cell.id, cell.status]));
  const anchorIndex = cellIdToIndex(anchor);
  const anchorRow = Math.floor(anchorIndex / BOARD_SIZE);
  const anchorColumn = anchorIndex % BOARD_SIZE;
  const cells: string[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let column = 0; column < BOARD_SIZE; column++) {
      const distance = Math.abs(row - anchorRow) + Math.abs(column - anchorColumn);
      if (distance === 0 || distance > radius) continue;
      const candidate = cellId(row, column);
      if (statuses.get(candidate) === "unknown") {
        cells.push(candidate);
      }
    }
  }

  return cells;
}

function collectClusterNeighborhoodCells(
  cluster: WorldHitCluster,
  depth: 1 | 2,
  worldCells: WorldCellState[],
): string[] {
  const statuses = new Map(worldCells.map((cell) => [cell.id, cell.status]));
  const clusterIds = new Set(cluster.cellIds);
  const cells = new Set<string>();

  for (const clusterCellId of cluster.cellIds) {
    const clusterIndex = cellIdToIndex(clusterCellId);
    const clusterRow = Math.floor(clusterIndex / BOARD_SIZE);
    const clusterColumn = clusterIndex % BOARD_SIZE;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let column = 0; column < BOARD_SIZE; column++) {
        const distance = Math.abs(row - clusterRow) + Math.abs(column - clusterColumn);
        if (distance === 0 || distance > depth) continue;
        const candidate = cellId(row, column);
        if (clusterIds.has(candidate)) continue;
        if (statuses.get(candidate) === "unknown") {
          cells.add(candidate);
        }
      }
    }
  }

  return [...cells];
}

function getQuadrantCells(quadrant: QuadrantName): string[] {
  switch (quadrant) {
    case "top-left":
      return enumerateRect(0, 3, 0, 3);
    case "top-right":
      return enumerateRect(0, 3, 4, 7);
    case "bottom-left":
      return enumerateRect(4, 7, 0, 3);
    case "bottom-right":
      return enumerateRect(4, 7, 4, 7);
  }
}

function enumerateRect(
  rowMin: number,
  rowMax: number,
  colMin: number,
  colMax: number,
): string[] {
  const cells: string[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let column = colMin; column <= colMax; column++) {
      cells.push(cellId(row, column));
    }
  }
  return cells;
}

function normalizeRowLabel(value: string): string | null {
  const row = value.trim().toUpperCase();
  return ROW_LABELS.includes(row as (typeof ROW_LABELS)[number]) ? row : null;
}

function normalizeColumnNumber(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= BOARD_SIZE ? value : null;
}

function normalizeCellId(value: string): string | null {
  if (!/^[A-H](?:[1-8])$/.test(value.trim().toUpperCase())) {
    return null;
  }
  return value.trim().toUpperCase();
}

function rowLabelToIndex(row: string): number {
  return ROW_LABELS.indexOf(row as (typeof ROW_LABELS)[number]);
}

function dedupeAndSortCellIds(cellIds: string[]): string[] {
  return unique(cellIds).sort((left, right) => cellIdToIndex(left) - cellIdToIndex(right));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function failure(
  code: QuestionSpecCompileFailure["code"],
  message: string,
): QuestionSpecCompileFailure {
  return { ok: false, code, message };
}
