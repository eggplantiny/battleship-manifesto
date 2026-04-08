/**
 * Hybrid question generator: LLM + template fallback.
 *
 * 1. Ask LLM for K/2 questions
 * 2. Fill remaining with template questions
 * 3. Score all by EIG, return top K
 */
import type { Board } from "../domain/types.js";
import type { GameState } from "../domain/game-state.js";
import type { BeliefSample } from "../belief/belief-state.js";
import type { LLMClient } from "../llm/client.js";
import { buildQuestionPrompt, buildManifestoPrompt } from "../legacy/llm/prompt.js";
import { parseLLMQuestions, type ParsedQuestion } from "../legacy/llm/parse-response.js";
import { findTemplateQuestionById, selectTemplateQuestions } from "./template-questions.js";
import { computeEIG, type ScoredQuestion } from "../belief/bayes.js";

export interface QuestionGeneratorConfig {
  totalCandidates: number;  // how many to score
  llmCandidates: number;    // how many from LLM
  epsilon: number;
  useLLM: boolean;
}

export const DEFAULT_QG_CONFIG: QuestionGeneratorConfig = {
  totalCandidates: 10,
  llmCandidates: 5,
  epsilon: 0,
  useLLM: true,
};

/**
 * Generate and score candidate questions.
 * Returns sorted by EIG (highest first).
 *
 * If `runtime` is provided, uses Manifesto-native prompt
 * (MEL + causal graph + snapshot + available actions).
 */
export async function generateScoredQuestions(
  gameState: GameState,
  snapshotData: Record<string, unknown>,
  snapshotComputed: Record<string, unknown>,
  particles: readonly BeliefSample[],
  askedQuestions: Set<string>,
  rngNext: () => number,
  llm: LLMClient | null,
  config: QuestionGeneratorConfig = DEFAULT_QG_CONFIG,
  runtime?: any,
): Promise<ScoredQuestion[]> {
  const candidates: ParsedQuestion[] = [];
  const previousQuestions = [...askedQuestions].map(
    (questionId) => findTemplateQuestionById(questionId)?.text ?? questionId,
  );

  // 1. Try LLM-generated questions
  if (config.useLLM && llm) {
    try {
      // Use Manifesto-native prompt if runtime is available
      const prompt = runtime
        ? buildManifestoPrompt(runtime, gameState, previousQuestions, config.llmCandidates)
        : buildQuestionPrompt(gameState, snapshotData, snapshotComputed, previousQuestions, config.llmCandidates);

      const response = await llm.chat([{ role: "user", content: prompt }]);

      const llmQuestions = parseLLMQuestions(response);
      for (const q of llmQuestions) {
        if (!askedQuestions.has(q.id ?? q.text)) {
          candidates.push(q);
        }
      }
    } catch (err) {
      // LLM failed — fall through to templates
      console.warn("LLM question generation failed:", (err as Error).message);
    }
  }

  // 2. Fill remaining with template questions
  const templateCount = config.totalCandidates - candidates.length;
  if (templateCount > 0) {
    const templates = selectTemplateQuestions(templateCount, askedQuestions, rngNext);
    for (const t of templates) {
      candidates.push(t);
    }
  }

  // 3. Score all by EIG (skip questions whose evaluate throws)
  const scored: ScoredQuestion[] = [];
  for (const q of candidates) {
    try {
      const eig = computeEIG(q.evaluate, particles, config.epsilon);
      scored.push({
        id: q.id,
        family: q.family,
        text: q.text,
        evaluate: q.evaluate,
        eig,
      });
    } catch {
      // evaluate function is broken for some boards — skip
    }
  }

  // Sort by EIG descending
  scored.sort((a, b) => b.eig - a.eig);
  return scored;
}
