export type CodifyProposalKind = "policy_patch" | "schema_patch";

export interface CodifyHypothesis {
  field: string;
  value: string;
  confidence: number;
  observationCount?: number;
}

export interface CodifyPolicyPatchSuggestion {
  field: string;
  value: number;
  rationale?: string;
}

export interface CodifyBeliefPatchSuggestion {
  field: string;
  value: string | number | boolean;
  rationale?: string;
}

export interface CodifyGoalPatchSuggestion {
  text: string;
  confidence: number;
}

export interface CodifyStructuredPatch {
  beliefPatches: CodifyBeliefPatchSuggestion[];
  goalPatch?: CodifyGoalPatchSuggestion | null;
  policyPatches: CodifyPolicyPatchSuggestion[];
  summary?: string | null;
}

export interface CodifySchemaPatchProposal {
  currentMel?: string | null;
  focusBlock?: string | null;
  instruction: string;
}

export interface CodifyPatchPromptInput {
  gameId: string;
  schemaVersion: number;
  goal: string;
  stepHistory: string[];
  softHypotheses: CodifyHypothesis[];
  currentMel?: string | null;
  focusBlock?: string | null;
  modelSummary?: string | null;
  allowedPolicyFields?: readonly string[];
}

export interface CodifySchemaPromptInput {
  gameId: string;
  schemaVersion: number;
  goal: string;
  stepHistory: string[];
  softHypotheses: CodifyHypothesis[];
  currentMel: string;
  instruction: string;
}

export interface CodifyPatchParseResult {
  success: boolean;
  patch: CodifyStructuredPatch;
  rawResponse: string | null;
  errors: string[];
}

export interface CodifyAgent {
  buildPatchPrompt(input: CodifyPatchPromptInput): string;
  buildSchemaRevisionPrompt(input: CodifySchemaPromptInput): string;
  parseStructuredPatch(raw: string, allowedPolicyFields?: readonly string[]): CodifyPatchParseResult;
}
