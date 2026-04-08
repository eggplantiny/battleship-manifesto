/**
 * Region-oriented question catalog used by M and MMP.
 *
 * Questions are treated like action descriptors:
 * stable id + human text + board evaluator.
 */
import type { Board } from "../../domain/types.js";
import { BOARD_SIZE, ROW_LABELS, cellId, cellIdToIndex } from "../../domain/types.js";

export type QuestionFamily =
  | "row"
  | "column"
  | "quadrant"
  | "row-band-2"
  | "column-band-2"
  | "block-2x2"
  | "frontier-ring"
  | "cluster-neighborhood"
  | "freeform";

export interface QuestionDescriptor {
  id: string;
  family: QuestionFamily;
  text: string;
  evaluate: (board: Board) => boolean;
  source?: "template" | "synthesized";
  regionCellIds?: string[];
}

export type TemplateQuestion = QuestionDescriptor;
export type QuestionBudgetBucket = "coarse" | "local" | "late";

export const COARSE_QUESTION_FAMILIES: readonly QuestionFamily[] = [
  "row",
  "column",
  "quadrant",
];

export const LOCAL_QUESTION_FAMILIES: readonly QuestionFamily[] = [
  "row-band-2",
  "column-band-2",
  "block-2x2",
];

const templates = buildTemplateQuestions();
const templatesById = new Map(templates.map((question) => [question.id, question]));
const templatesByText = new Map(
  templates.map((question) => [normalizeQuestionText(question.text), question]),
);

function buildTemplateQuestions(): QuestionDescriptor[] {
  const questions: QuestionDescriptor[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    const label = ROW_LABELS[row];
    questions.push({
      id: `row:${label}`,
      family: "row",
      text: `Is there a ship in row ${label}?`,
      evaluate: (board) => board.cells.some((cell) => cell.row === row && cell.hasShip),
    });
  }

  for (let col = 0; col < BOARD_SIZE; col++) {
    const label = `${col + 1}`;
    questions.push({
      id: `column:${label}`,
      family: "column",
      text: `Is there a ship in column ${label}?`,
      evaluate: (board) => board.cells.some((cell) => cell.col === col && cell.hasShip),
    });
  }

  const quadrants = [
    { id: "quadrant:top-left", name: "top-left", rMin: 0, rMax: 3, cMin: 0, cMax: 3 },
    { id: "quadrant:top-right", name: "top-right", rMin: 0, rMax: 3, cMin: 4, cMax: 7 },
    { id: "quadrant:bottom-left", name: "bottom-left", rMin: 4, rMax: 7, cMin: 0, cMax: 3 },
    { id: "quadrant:bottom-right", name: "bottom-right", rMin: 4, rMax: 7, cMin: 4, cMax: 7 },
  ];

  for (const quadrant of quadrants) {
    questions.push({
      id: quadrant.id,
      family: "quadrant",
      text: `Is there a ship in the ${quadrant.name} quadrant?`,
      evaluate: (board) =>
        board.cells.some((cell) =>
          cell.row >= quadrant.rMin &&
          cell.row <= quadrant.rMax &&
          cell.col >= quadrant.cMin &&
          cell.col <= quadrant.cMax &&
          cell.hasShip
        ),
    });
  }

  for (let startRow = 0; startRow < BOARD_SIZE - 1; startRow++) {
    const first = ROW_LABELS[startRow];
    const second = ROW_LABELS[startRow + 1];
    questions.push({
      id: `row-band-2:${first}-${second}`,
      family: "row-band-2",
      text: `Is there a ship in rows ${first}-${second}?`,
      evaluate: (board) =>
        board.cells.some((cell) =>
          (cell.row === startRow || cell.row === startRow + 1) &&
          cell.hasShip
        ),
    });
  }

  for (let startCol = 0; startCol < BOARD_SIZE - 1; startCol++) {
    const first = `${startCol + 1}`;
    const second = `${startCol + 2}`;
    questions.push({
      id: `column-band-2:${first}-${second}`,
      family: "column-band-2",
      text: `Is there a ship in columns ${first}-${second}?`,
      evaluate: (board) =>
        board.cells.some((cell) =>
          (cell.col === startCol || cell.col === startCol + 1) &&
          cell.hasShip
        ),
    });
  }

  for (let row = 0; row < BOARD_SIZE - 1; row++) {
    for (let col = 0; col < BOARD_SIZE - 1; col++) {
      const topLeft = cellId(row, col);
      const bottomRight = cellId(row + 1, col + 1);
      questions.push({
        id: `block-2x2:${topLeft}-${bottomRight}`,
        family: "block-2x2",
        text: `Is there a ship in block ${topLeft}-${bottomRight}?`,
        evaluate: (board) =>
          board.cells.some((cell) =>
            cell.row >= row &&
            cell.row <= row + 1 &&
            cell.col >= col &&
            cell.col <= col + 1 &&
            cell.hasShip
          ),
      });
    }
  }

  return questions;
}

export function getTemplateQuestions(): QuestionDescriptor[] {
  return [...templates];
}

export function findTemplateQuestionById(id: string): QuestionDescriptor | null {
  return templatesById.get(id) ?? null;
}

export function findTemplateQuestionByText(text: string): QuestionDescriptor | null {
  return templatesByText.get(normalizeQuestionText(text)) ?? null;
}

export function createQuestionIdFromText(text: string): string {
  const normalized = normalizeQuestionText(text);
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `freeform:${slug || "question"}`;
}

export function resolveQuestionDescriptor(
  text: string,
  evaluate: (board: Board) => boolean,
): QuestionDescriptor {
  return findTemplateQuestionByText(text) ?? {
    id: createQuestionIdFromText(text),
    family: "freeform",
    text,
    evaluate,
  };
}

/**
 * Select N questions that have not been asked yet.
 * Sampling is family-diversified so large block catalogs do not drown out
 * simpler row/column questions.
 */
export function selectTemplateQuestions(
  count: number,
  askedQuestions: Set<string>,
  rngNext: () => number,
): QuestionDescriptor[] {
  const buckets = new Map<QuestionFamily, QuestionDescriptor[]>();

  for (const question of templates) {
    if (isQuestionAlreadyAsked(askedQuestions, question)) continue;
    const bucket = buckets.get(question.family);
    if (bucket) {
      bucket.push(question);
    } else {
      buckets.set(question.family, [question]);
    }
  }

  const families = [...buckets.keys()];
  shuffleInPlace(families, rngNext);
  for (const family of families) {
    const bucket = buckets.get(family);
    if (bucket) shuffleInPlace(bucket, rngNext);
  }

  const selected: QuestionDescriptor[] = [];
  while (selected.length < count) {
    let madeProgress = false;
    for (const family of families) {
      const bucket = buckets.get(family);
      if (!bucket || bucket.length === 0) continue;
      const question = bucket.pop();
      if (!question) continue;
      selected.push(question);
      madeProgress = true;
      if (selected.length >= count) break;
    }

    if (!madeProgress) break;
  }

  return selected;
}

export function isCoarseQuestionFamily(family: QuestionFamily): boolean {
  return COARSE_QUESTION_FAMILIES.includes(family);
}

export function isLocalQuestionFamily(family: QuestionFamily): boolean {
  return LOCAL_QUESTION_FAMILIES.includes(family);
}

export function inferQuestionFamilyFromId(questionId: string): QuestionFamily {
  if (questionId.startsWith("row:")) return "row";
  if (questionId.startsWith("column:")) return "column";
  if (questionId.startsWith("quadrant:")) return "quadrant";
  if (questionId.startsWith("row-band-2:")) return "row-band-2";
  if (questionId.startsWith("column-band-2:")) return "column-band-2";
  if (questionId.startsWith("block-2x2:")) return "block-2x2";
  if (questionId.startsWith("frontier-ring:")) return "frontier-ring";
  if (questionId.startsWith("cluster-neighborhood:")) return "cluster-neighborhood";
  return "freeform";
}

export function classifyQuestionBudgetBucket(
  questionId: string,
  turnAsked: number,
  lateGameTurn: number,
): QuestionBudgetBucket {
  if (turnAsked >= lateGameTurn) {
    return "late";
  }

  return isCoarseQuestionFamily(inferQuestionFamilyFromId(questionId)) ? "coarse" : "local";
}

export function getQuestionRegionCellIds(questionId: string): string[] {
  if (questionId.startsWith("row:")) {
    const rowLabel = questionId.slice("row:".length);
    const row = ROW_LABELS.indexOf(rowLabel as (typeof ROW_LABELS)[number]);
    if (row < 0) return [];
    return Array.from({ length: BOARD_SIZE }, (_, col) => cellId(row, col));
  }

  if (questionId.startsWith("column:")) {
    const columnLabel = questionId.slice("column:".length);
    const column = Number.parseInt(columnLabel, 10) - 1;
    if (column < 0 || column >= BOARD_SIZE) return [];
    return Array.from({ length: BOARD_SIZE }, (_, row) => cellId(row, column));
  }

  if (questionId === "quadrant:top-left") {
    return enumerateRegionCells(0, 3, 0, 3);
  }
  if (questionId === "quadrant:top-right") {
    return enumerateRegionCells(0, 3, 4, 7);
  }
  if (questionId === "quadrant:bottom-left") {
    return enumerateRegionCells(4, 7, 0, 3);
  }
  if (questionId === "quadrant:bottom-right") {
    return enumerateRegionCells(4, 7, 4, 7);
  }

  if (questionId.startsWith("row-band-2:")) {
    const body = questionId.slice("row-band-2:".length);
    const [firstRowLabel, secondRowLabel] = body.split("-");
    const firstRow = ROW_LABELS.indexOf(firstRowLabel as (typeof ROW_LABELS)[number]);
    const secondRow = ROW_LABELS.indexOf(secondRowLabel as (typeof ROW_LABELS)[number]);
    if (firstRow < 0 || secondRow < 0) return [];
    return enumerateRegionCells(Math.min(firstRow, secondRow), Math.max(firstRow, secondRow), 0, 7);
  }

  if (questionId.startsWith("column-band-2:")) {
    const body = questionId.slice("column-band-2:".length);
    const [firstColumnLabel, secondColumnLabel] = body.split("-");
    const firstColumn = Number.parseInt(firstColumnLabel, 10) - 1;
    const secondColumn = Number.parseInt(secondColumnLabel, 10) - 1;
    if ([firstColumn, secondColumn].some((column) => Number.isNaN(column))) return [];
    return enumerateRegionCells(0, 7, Math.min(firstColumn, secondColumn), Math.max(firstColumn, secondColumn));
  }

  if (questionId.startsWith("block-2x2:")) {
    const body = questionId.slice("block-2x2:".length);
    const [topLeftId, bottomRightId] = body.split("-");
    if (!topLeftId || !bottomRightId) return [];
    const topLeftIndex = cellIdToIndex(topLeftId);
    const bottomRightIndex = cellIdToIndex(bottomRightId);
    const topLeftRow = Math.floor(topLeftIndex / BOARD_SIZE);
    const topLeftCol = topLeftIndex % BOARD_SIZE;
    const bottomRightRow = Math.floor(bottomRightIndex / BOARD_SIZE);
    const bottomRightCol = bottomRightIndex % BOARD_SIZE;
    return enumerateRegionCells(topLeftRow, bottomRightRow, topLeftCol, bottomRightCol);
  }

  return [];
}

function isQuestionAlreadyAsked(
  askedQuestions: Set<string>,
  question: QuestionDescriptor,
): boolean {
  return askedQuestions.has(question.id) ||
    askedQuestions.has(question.text) ||
    askedQuestions.has(normalizeQuestionText(question.text));
}

function normalizeQuestionText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function enumerateRegionCells(
  rowMin: number,
  rowMax: number,
  colMin: number,
  colMax: number,
): string[] {
  const cells: string[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      cells.push(cellId(row, col));
    }
  }
  return cells;
}

function shuffleInPlace<T>(values: T[], rngNext: () => number): void {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rngNext() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}
