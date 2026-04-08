import type { BattleshipEffectTelemetryStore } from "./effect-telemetry.js";

export interface BattleshipEffectOptions {
  model?: string;
  baseUrl?: string;
  telemetry?: BattleshipEffectTelemetryStore;
}

interface LLMDecisionParams {
  systemPrompt?: unknown;
  userPrompt?: unknown;
  candidateCellsCsv?: unknown;
  bestQuestionId?: unknown;
  bestQuestionText?: unknown;
}

interface EffectHandlerContext {
  readonly snapshot: unknown;
}

type Patch =
  | { op: "set"; path: PatchPath; value: unknown }
  | { op: "unset"; path: PatchPath }
  | { op: "merge"; path: PatchPath; value: Record<string, unknown> };

type PatchPath = Array<
  | { kind: "prop"; name: string }
  | { kind: "index"; index: number }
>;

const DEFAULT_MODEL = "gemma3:4b-it-qat";
const DEFAULT_BASE_URL = "http://localhost:11434";

export function createBattleshipEffects(options: BattleshipEffectOptions = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const telemetry = options.telemetry;

  return {
    "llm.decide": async (params: unknown, _ctx: EffectHandlerContext): Promise<readonly Patch[]> => {
      const startedAt = Date.now();
      const input = normalizeParams(params);

      if (!input.systemPrompt || !input.userPrompt) {
        return createFailurePatches("missing_prompt", Date.now() - startedAt, telemetry);
      }

      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: input.systemPrompt },
              { role: "user", content: input.userPrompt },
            ],
          }),
        });

        if (!response.ok) {
          return createFailurePatches(
            `ollama_${response.status}_${response.statusText}`,
            Date.now() - startedAt,
            telemetry,
          );
        }

        const data = await response.json() as { message?: { content?: unknown } };
        const rawResponse = typeof data.message?.content === "string"
          ? data.message.content.trim()
          : "";
        const parsed = parseDecision(
          rawResponse,
          input.candidateCellsCsv,
          input.bestQuestionId,
          input.bestQuestionText,
        );
        const latencyMs = Date.now() - startedAt;
        telemetry?.recordLLMDecision({
          rawResponse,
          errorMessage: "",
          latencyMs,
        });

        return [
          setPatch(path("llmStatus"), "success"),
          setPatch(path("thinkingPhase"), "llm_resolved"),
          setPatch(path("llmDecisionAction"), parsed.action),
          setPatch(path("llmDecisionCellId"), parsed.cellId),
          setPatch(path("llmDecisionQuestionId"), parsed.questionId),
          setPatch(path("llmDecisionQuestionText"), parsed.questionText),
        ];
      } catch (error) {
        return createFailurePatches(
          error instanceof Error ? error.message : String(error),
          Date.now() - startedAt,
          telemetry,
        );
      }
    },
  };
}

function normalizeParams(params: unknown): {
  systemPrompt: string;
  userPrompt: string;
  candidateCellsCsv: string;
  bestQuestionId: string;
  bestQuestionText: string;
} {
  if (!isRecord(params)) {
    return {
      systemPrompt: "",
      userPrompt: "",
      candidateCellsCsv: "",
      bestQuestionId: "",
      bestQuestionText: "",
    };
  }

  const typed = params as LLMDecisionParams;
  return {
    systemPrompt: asString(typed.systemPrompt),
    userPrompt: asString(typed.userPrompt),
    candidateCellsCsv: asString(typed.candidateCellsCsv),
    bestQuestionId: asString(typed.bestQuestionId),
    bestQuestionText: asString(typed.bestQuestionText),
  };
}

function parseDecision(
  rawResponse: string,
  candidateCellsCsv: string,
  bestQuestionId: string,
  bestQuestionText: string,
): { action: string; cellId: string; questionId: string; questionText: string } {
  const firstLine = rawResponse.split("\n")[0]?.trim() ?? "";
  const candidateCells = candidateCellsCsv
    .split(",")
    .map((cell) => cell.trim().toUpperCase())
    .filter((cell) => cell.length > 0);

  const shootMatch = firstLine.match(/shoot\s+([A-Ha-h]\d)/i);
  if (shootMatch) {
    return {
      action: "shoot",
      cellId: shootMatch[1].toUpperCase(),
      questionId: "",
      questionText: "",
    };
  }

  const askMatch = firstLine.match(/askQuestion\s+"?([^"]+)"?/i);
  if (askMatch) {
    return {
      action: "question",
      cellId: "",
      questionId: bestQuestionId,
      questionText: bestQuestionText || askMatch[1].trim(),
    };
  }

  const numberMatch = firstLine.match(/^([1-5])$/);
  if (numberMatch) {
    const selectedCell = candidateCells[Number.parseInt(numberMatch[1], 10) - 1] ?? "";
    return {
      action: selectedCell ? "shoot" : "",
      cellId: selectedCell,
      questionId: "",
      questionText: "",
    };
  }

  return {
    action: "",
    cellId: "",
    questionId: "",
    questionText: "",
  };
}

function createFailurePatches(
  message: string,
  latencyMs: number,
  telemetry?: BattleshipEffectTelemetryStore,
): readonly Patch[] {
  telemetry?.recordLLMDecision({
    rawResponse: "",
    errorMessage: message,
    latencyMs,
  });
  return [
    setPatch(path("llmStatus"), "error"),
    setPatch(path("thinkingPhase"), "llm_failed"),
    setPatch(path("llmDecisionAction"), ""),
    setPatch(path("llmDecisionCellId"), ""),
    setPatch(path("llmDecisionQuestionId"), ""),
    setPatch(path("llmDecisionQuestionText"), ""),
  ];
}

function path(name: string) {
  return [{ kind: "prop" as const, name }];
}

function setPatch(path: PatchPath, value: unknown): Patch {
  return { op: "set", path, value };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
