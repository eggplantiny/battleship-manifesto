import { formatQuestionSpecGrammar } from "../../../questions/question-spec.js";
import type { ExperimentPipelineStage } from "../../../pipeline/experiment-pipeline.js";
import type { TurnContext, TurnDecision } from "../../strategy.js";
import type {
  RankedQuestionCandidate,
  ReasonCode,
  SalvageCandidateBundle,
  SalvagePromptPayload,
} from "./types.js";

export function createDecisionSystemPrompt(): string {
  return [
    "You choose one legal recovery move inside a constitution-governed Battleship world.",
    "Legality is enforced by the runtime. Read only the available actions, graph slice, snapshot, template candidates, and allowed question grammar.",
    "Choose exactly one legal move.",
    "If a listed template question already fits, prefer returning its questionId.",
    "If none of the listed template questions fit, you may synthesize one legal questionSpec from the grammar.",
    'Reply with JSON only: { "action": "shoot", "cellId": "D6" } or { "action": "question", "questionId": "block-2x2:D5-E6" } or { "action": "question", "questionSpec": { ... } }',
  ].join("\n");
}

export function createExplanationSystemPrompt(melSource: string): string {
  return [
    "You explain a decision that was already made inside a constitution-governed Battleship world.",
    "This MEL is the constitution of that world and the full source code of the agent's operating soul.",
    "Do not change the decision. Explain why the chosen legal action makes sense given the current Manifesto snapshot and graph slice.",
    "Reply with JSON only.",
    'Schema: { "reason": "cluster_split|region_split|closeout_shot|best_hit_prob|uncertain_recovery", "explanation": "one short sentence" }',
    "",
    melSource,
  ].join("\n");
}

export function createDecisionPromptStage(
  systemPrompt: string,
): ExperimentPipelineStage<SalvageCandidateBundle, SalvagePromptPayload> {
  return {
    name: "wma_salvage_prompt",
    async run(input) {
      return {
        value: {
          systemPrompt,
          userPrompt: buildWeakBoardDecisionPrompt(input.ctx, input, input.topShootCandidates, input.topQuestionCandidates),
        },
        status: "success",
        metadata: {
          shootCandidateCount: input.topShootCandidates.length,
          questionCandidateCount: input.topQuestionCandidates.length,
        },
      };
    },
  };
}

export function buildExplanationPrompt(
  ctx: TurnContext,
  input: SalvageCandidateBundle,
  decision: TurnDecision,
): string {
  const currentSnapshot = {
    data: ctx.bridge.data,
    computed: ctx.bridge.computed,
  };
  const chosenIntent = decision.action === "shoot"
    ? { action: "shoot", cellId: decision.cellId ?? null }
    : {
        action: "question",
        questionId: decision.questionId ?? null,
        questionSource: decision.questionSource ?? null,
        questionSpec: decision.questionSpec ?? null,
      };

  return [
    `Turn: ${String(ctx.bridge.data.turnNumber ?? 0)}`,
    `Available root actions: ${formatAvailableActions(ctx)}`,
    "",
    "Constitutional graph slice:",
    buildSchemaGraphBrief(ctx),
    "",
    "Current Manifesto snapshot:",
    JSON.stringify(currentSnapshot, null, 2),
    "",
    "Chosen legal intent:",
    JSON.stringify(chosenIntent, null, 2),
    "",
    "Candidate legal shoot intents:",
    ...formatShotLines(input.topShootCandidates),
    "",
    "Candidate legal question intents:",
    ...formatQuestionLines(input.topQuestionCandidates),
    "",
    `State cue: bestHitProb=${input.summary.bestHitProb.toFixed(3)}, frontierCount=${input.summary.frontierCount}, largestHitClusterSize=${input.summary.largestHitClusterSize}`,
    "Return a reason enum and one short explanation sentence for the already chosen intent.",
  ].join("\n");
}

function buildWeakBoardDecisionPrompt(
  ctx: TurnContext,
  input: SalvageCandidateBundle,
  topShootCandidates: Array<{ cellId: string; hitProb: number; boardValue: number }>,
  topQuestionCandidates: RankedQuestionCandidate[],
): string {
  const currentSnapshot = {
    data: ctx.bridge.data,
    computed: ctx.bridge.computed,
  };

  return [
    `Turn: ${String(ctx.bridge.data.turnNumber ?? 0)}`,
    `Available root actions: ${formatAvailableActions(ctx)}`,
    "",
    "Constitutional graph slice:",
    buildSchemaGraphBrief(ctx),
    "",
    "Current Manifesto snapshot:",
    JSON.stringify(currentSnapshot, null, 2),
    "",
    "Candidate legal shoot intents:",
    ...formatShotLines(topShootCandidates),
    "",
    "Candidate legal template question intents:",
    ...formatQuestionLines(topQuestionCandidates),
    "",
    formatQuestionSpecGrammar(input.summary),
    "If you synthesize a new question, return questionSpec only. Do not write free-form question text.",
    "",
    `State cue: bestHitProb=${input.summary.bestHitProb.toFixed(3)}, frontierCount=${input.summary.frontierCount}, largestHitClusterSize=${input.summary.largestHitClusterSize}`,
    "Choose exactly one legal move and return JSON only.",
  ].join("\n");
}

function formatShotLines(
  candidates: Array<{ cellId: string; hitProb: number; boardValue: number }>,
): string[] {
  return candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.cellId} | hitProb=${candidate.hitProb.toFixed(3)} | value=${candidate.boardValue.toFixed(3)}`
  );
}

function formatQuestionLines(candidates: RankedQuestionCandidate[]): string[] {
  return candidates.map((candidate, index) =>
    `${index + 1}. ${candidate.question.id} | ${candidate.question.text} | value=${candidate.adjustedValue.toFixed(3)} | split=${candidate.splitQuality.toFixed(3)} | mass=${candidate.regionMass.toFixed(3)} | cluster=${(candidate.clusterRelevance ?? 0).toFixed(3)}`
  );
}

function formatAvailableActions(ctx: TurnContext): string {
  const available = ctx.bridge.availableActions;
  return available.length > 0 ? available.join(", ") : "(none)";
}

function buildSchemaGraphBrief(ctx: TurnContext): string {
  const graph = ctx.bridge.schemaGraph;
  const sections = [
    { label: "shoot", edges: safeTraceEdges(graph, "action:shoot", "down", 4) },
    { label: "askQuestion", edges: safeTraceEdges(graph, "action:askQuestion", "down", 4) },
    { label: "lateSalvagePhase", edges: safeTraceEdges(graph, "computed:lateSalvagePhase", "up", 4) },
    { label: "boardValue", edges: safeTraceEdges(graph, "computed:boardValue", "up", 4) },
  ];

  const lines: string[] = [];
  for (const section of sections) {
    if (section.edges.length === 0) continue;
    lines.push(`${section.label}:`);
    for (const edge of section.edges) {
      lines.push(`- ${edge}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(graph unavailable)";
}

function safeTraceEdges(
  graph: {
    traceUp(target: string): { edges: Array<{ from: string; relation: string; to: string }> };
    traceDown(target: string): { edges: Array<{ from: string; relation: string; to: string }> };
  },
  target: string,
  direction: "up" | "down",
  limit: number,
): string[] {
  try {
    const projected = direction === "up" ? graph.traceUp(target) : graph.traceDown(target);
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const edge of projected.edges) {
      const line = `${edge.from} -[${edge.relation}]-> ${edge.to}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
      if (lines.length >= limit) break;
    }
    return lines;
  } catch {
    return [];
  }
}

export function parseReasonCode(value: unknown): ReasonCode | undefined {
  switch (value) {
    case "cluster_split":
    case "region_split":
    case "closeout_shot":
    case "best_hit_prob":
    case "uncertain_recovery":
      return value;
    default:
      return undefined;
  }
}
