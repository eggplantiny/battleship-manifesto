import type {
  CodifyGoalPatchSuggestion,
  CodifyPatchParseResult,
  CodifyPolicyPatchSuggestion,
  CodifyStructuredPatch,
} from "./types.js";

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw.trim();
  if (!candidate) return null;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}

function normalizeGoalPatch(value: unknown): CodifyGoalPatchSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const goal = value as Record<string, unknown>;
  if (typeof goal.text !== "string" || goal.text.trim().length === 0) return null;
  if (!Number.isFinite(Number(goal.confidence))) return null;
  return {
    text: goal.text.trim(),
    confidence: clampUnit(Number(goal.confidence)),
  };
}

function normalizePolicyPatch(value: unknown): CodifyPolicyPatchSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.field !== "string" || entry.field.trim().length === 0) return null;
  if (!Number.isFinite(Number(entry.value))) return null;
  return {
    field: entry.field.trim(),
    value: Number(entry.value),
    ...(typeof entry.rationale === "string" && entry.rationale.trim().length > 0
      ? { rationale: entry.rationale.trim() }
      : {}),
  };
}

function normalizeBeliefPatch(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.field !== "string" || entry.field.trim().length === 0) return null;
  const normalizedValue = entry.value;
  if (
    typeof normalizedValue !== "string" &&
    typeof normalizedValue !== "number" &&
    typeof normalizedValue !== "boolean"
  ) {
    return null;
  }
  return {
    field: entry.field.trim(),
    value: normalizedValue,
    ...(typeof entry.rationale === "string" && entry.rationale.trim().length > 0
      ? { rationale: entry.rationale.trim() }
      : {}),
  };
}

export function parseStructuredPatch(
  raw: string,
  allowedPolicyFields?: readonly string[],
): CodifyPatchParseResult {
  const fallbackPatch: CodifyStructuredPatch = {
    beliefPatches: [],
    policyPatches: [],
  };

  const json = extractJsonObject(raw);
  if (!json) {
    return {
      success: false,
      patch: fallbackPatch,
      rawResponse: raw,
      errors: ["missing-json-object"],
    };
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const beliefPatches = Array.isArray(parsed.beliefPatches)
      ? parsed.beliefPatches.map(normalizeBeliefPatch).filter((item): item is NonNullable<ReturnType<typeof normalizeBeliefPatch>> => Boolean(item))
      : [];
    let policyPatches = Array.isArray(parsed.policyPatches)
      ? parsed.policyPatches.map(normalizePolicyPatch).filter((item): item is CodifyPolicyPatchSuggestion => Boolean(item))
      : [];
    if (allowedPolicyFields && allowedPolicyFields.length > 0) {
      const allowed = new Set(allowedPolicyFields);
      policyPatches = policyPatches.filter((item) => allowed.has(item.field));
    }
    const goalPatch = normalizeGoalPatch(parsed.goalPatch);
    const summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : null;

    return {
      success: true,
      patch: {
        beliefPatches,
        goalPatch,
        policyPatches,
        summary,
      },
      rawResponse: raw,
      errors: [],
    };
  } catch (error) {
    return {
      success: false,
      patch: fallbackPatch,
      rawResponse: raw,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
