import type { WorldQuestionEvalResult, WorldSimResult } from "../../../core/simulation-world.js";
import type { WorldBeliefSummary } from "../../../core/world-belief-summary.js";
import type { QuestionSpec } from "../../../questions/question-spec.js";
import type { QuestionDescriptor } from "../../../questions/template-questions.js";
import type { TurnContext, TurnDecision } from "../../strategy.js";

export interface RankedQuestionCandidate {
  question: QuestionDescriptor;
  detail: WorldQuestionEvalResult;
  adjustedValue: number;
  splitQuality: number;
  regionMass: number;
  clusterRelevance?: number;
}

export interface LLMDecisionChoice {
  action: "shoot" | "question";
  cellId?: string;
  questionId?: string;
  questionSpec?: QuestionSpec;
}

export interface SalvagePromptPayload {
  systemPrompt: string;
  userPrompt: string;
}

export interface LLMExplanationChoice {
  reason?: ReasonCode;
  explanation?: string;
}

export type ReasonCode =
  | "cluster_split"
  | "region_split"
  | "closeout_shot"
  | "best_hit_prob"
  | "uncertain_recovery";

export interface DecisionResolution {
  decision: TurnDecision;
  questionSource?: "template" | "synthesized";
  questionSpec?: QuestionSpec;
}

export interface SalvageSummaryState {
  ctx: TurnContext;
  shootResults: WorldSimResult[];
  bestShoot: WorldSimResult;
  summary: WorldBeliefSummary;
  frontierCellIds: Set<string>;
  data: Record<string, unknown>;
  hasKnownHits: boolean;
  turnNumber: number;
  isLateGame: boolean;
  coarseAsked: number;
  lateAsked: number;
}

export interface SalvageCandidateBundle extends SalvageSummaryState {
  rankedCoarse: RankedQuestionCandidate[];
  rankedSalvage: RankedQuestionCandidate[];
  bestQuestionCandidate: RankedQuestionCandidate | null;
  bestQuestion: QuestionDescriptor | null;
  bestQuestionValue: number;
  defaultDecision: TurnDecision;
  defaultReason: string;
  topShootCandidates: WorldSimResult[];
  topQuestionCandidates: RankedQuestionCandidate[];
}

export interface SalvageDecisionPromptInput {
  bundle: SalvageCandidateBundle;
  prompt: SalvagePromptPayload;
}

export interface SalvageLLMDecisionResult {
  choice: LLMDecisionChoice | null;
  latencyMs: number;
  errorMessage: string | null;
}

export interface SalvageCompileInput {
  bundle: SalvageCandidateBundle;
  llmResult: SalvageLLMDecisionResult;
}
