import { PATCH_PROMPT_TEMPLATE, REVISE_PROMPT_TEMPLATE } from "./prompts.js";
import { parseStructuredPatch } from "./parse.js";
import type {
  CodifyAgent,
  CodifyPatchPromptInput,
  CodifySchemaPromptInput,
} from "./types.js";

function summarizeHypothesis(input: CodifyPatchPromptInput["softHypotheses"][number]): string {
  return [
    `field=${input.field}`,
    `value=${input.value}`,
    `confidence=${input.confidence.toFixed(2)}`,
    `observations=${Math.max(1, Math.round(input.observationCount ?? 1))}`,
  ].join(" ");
}

function buildPatchPrompt(input: CodifyPatchPromptInput): string {
  const allowedPolicyFieldLines = input.allowedPolicyFields && input.allowedPolicyFields.length > 0
    ? input.allowedPolicyFields.map((field) => `- ${field}`).join("\n")
    : "- none";

  return [
    PATCH_PROMPT_TEMPLATE,
    `Game id: ${input.gameId}`,
    `Schema version target: ${input.schemaVersion}`,
    `Goal: ${input.goal}`,
    `Soft hypotheses:\n${input.softHypotheses.map((item) => `- ${summarizeHypothesis(item)}`).join("\n") || "- none"}`,
    `Recent step history:\n${input.stepHistory.slice(-10).map((item) => `- ${item}`).join("\n") || "- none"}`,
    input.modelSummary ? `Current model summary:\n${input.modelSummary}` : null,
    input.focusBlock ? `Current Manifesto focus:\n\`\`\`mel\n${input.focusBlock}\n\`\`\`` : null,
    input.currentMel ? `Current active MEL:\n\`\`\`mel\n${input.currentMel}\n\`\`\`` : null,
    `Allowed policy fields:\n${allowedPolicyFieldLines}`,
    "Output a single JSON object only.",
  ].filter(Boolean).join("\n\n");
}

function buildSchemaRevisionPrompt(input: CodifySchemaPromptInput): string {
  return [
    REVISE_PROMPT_TEMPLATE,
    `Game id: ${input.gameId}`,
    `Schema version target: ${input.schemaVersion}`,
    `Goal: ${input.goal}`,
    `Soft hypotheses:\n${input.softHypotheses.map((item) => `- ${summarizeHypothesis(item)}`).join("\n") || "- none"}`,
    `Recent step history:\n${input.stepHistory.slice(-10).map((item) => `- ${item}`).join("\n") || "- none"}`,
    `Instruction: ${input.instruction}`,
    "Current active MEL:",
    "```mel",
    input.currentMel,
    "```",
  ].join("\n\n");
}

export function createCodifyAgent(): CodifyAgent {
  return {
    buildPatchPrompt,
    buildSchemaRevisionPrompt,
    parseStructuredPatch,
  };
}
