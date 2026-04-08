import { createCodifyAgent } from "./codify-agent.js";
import type {
  CodifyAgent,
  CodifyPatchParseResult,
  CodifyPatchPromptInput,
  CodifySchemaPromptInput,
} from "./types.js";

export interface CodifyStageResult<T> {
  value: T;
  status?: string;
  proposalKind?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CodifyStageLike<I, O> {
  readonly name: string;
  run(input: I, ctx?: unknown): Promise<CodifyStageResult<O>>;
}

export interface CodifyPatchParseInput {
  rawResponse: string;
  allowedPolicyFields?: readonly string[];
}

export function createCodifyPatchPromptStage(
  agent: CodifyAgent = createCodifyAgent(),
): CodifyStageLike<CodifyPatchPromptInput, string> {
  return {
    name: "codify_build_patch_prompt",
    async run(input) {
      return {
        value: agent.buildPatchPrompt(input),
        status: "success",
        proposalKind: "policy_patch",
        metadata: {
          gameId: input.gameId,
          schemaVersion: input.schemaVersion,
          allowedPolicyFieldCount: input.allowedPolicyFields?.length ?? 0,
        },
      };
    },
  };
}

export function createCodifyPatchParseStage(
  agent: CodifyAgent = createCodifyAgent(),
): CodifyStageLike<CodifyPatchParseInput, CodifyPatchParseResult> {
  return {
    name: "codify_parse_patch_proposal",
    async run(input) {
      const result = agent.parseStructuredPatch(input.rawResponse, input.allowedPolicyFields);
      return {
        value: result,
        status: result.success ? "success" : "error",
        proposalKind: "policy_patch",
        metadata: {
          success: result.success,
          errorCount: result.errors.length,
        },
      };
    },
  };
}

export function createCodifySchemaPromptStage(
  agent: CodifyAgent = createCodifyAgent(),
): CodifyStageLike<CodifySchemaPromptInput, string> {
  return {
    name: "codify_build_schema_prompt",
    async run(input) {
      return {
        value: agent.buildSchemaRevisionPrompt(input),
        status: "success",
        proposalKind: "schema_patch",
        metadata: {
          gameId: input.gameId,
          schemaVersion: input.schemaVersion,
        },
      };
    },
  };
}
