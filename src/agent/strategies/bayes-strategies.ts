import { indexToCellId } from "../../domain/types.js";
import { computeEIG, selectBestShot, shouldAskQuestion, type ScoredQuestion } from "../bayes.js";
import { generateScoredQuestions } from "../questions/question-generator.js";
import { OllamaClient } from "../legacy-llm/ollama.js";
import { selectTemplateQuestions } from "../questions/template-questions.js";
import type { Strategy, TurnContext, TurnDecision } from "./strategy.js";

function getQuestionId(question: ScoredQuestion): string {
  return typeof question.id === "string" && question.id.length > 0
    ? question.id
    : question.text;
}

export class RandomStrategy implements Strategy {
  name = "random";

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const revealed = ctx.gameState.getRevealedCellIndices();
    const candidates: number[] = [];

    for (let cellIndex = 0; cellIndex < 64; cellIndex++) {
      if (!revealed.has(cellIndex)) candidates.push(cellIndex);
    }

    const picked = candidates[ctx.rng.nextInt(candidates.length)] ?? 0;
    return { action: "shoot", cellId: indexToCellId(picked) };
  }
}

export class GreedyStrategy implements Strategy {
  name = "greedy";

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const revealed = ctx.gameState.getRevealedCellIndices();
    const hitProbs = ctx.particles.getHitProbabilities(revealed);
    return { action: "shoot", cellId: indexToCellId(selectBestShot(hitProbs)) };
  }
}

export class BayesStrategy implements Strategy {
  name = "bayes";

  constructor(
    private readonly candidateQuestions: number = 10,
    private readonly gamma: number = 0.95,
  ) {}

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const revealed = ctx.gameState.getRevealedCellIndices();
    const hitProbs = ctx.particles.getHitProbabilities(revealed);
    const bestCellIndex = selectBestShot(hitProbs);

    if ((ctx.bridge.data.questionsRemaining as number) <= 0) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    const candidates = selectTemplateQuestions(
      this.candidateQuestions,
      ctx.askedQuestions,
      () => ctx.rng.next(),
    );
    const scored = candidates.map((question) => ({
      id: question.id,
      family: question.family,
      text: question.text,
      evaluate: question.evaluate,
      eig: computeEIG(question.evaluate, ctx.particles.samples, ctx.epsilon),
    }));
    scored.sort((left, right) => right.eig - left.eig);

    const bestQuestion = scored[0];
    if (!bestQuestion) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    if (!shouldAskQuestion(bestQuestion, hitProbs, ctx.particles.samples, this.gamma, ctx.epsilon)) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    const questionId = getQuestionId(bestQuestion);
    ctx.askedQuestions.add(questionId);
    return {
      action: "question",
      questionId,
      questionText: bestQuestion.text,
      evaluate: bestQuestion.evaluate,
    };
  }
}

export class BayesLLMStrategy implements Strategy {
  name = "bayes-llm";
  private readonly ollama: OllamaClient;

  constructor(
    model: string,
    private readonly candidateQuestions: number = 10,
    private readonly llmCandidates: number = 5,
    private readonly gamma: number = 0.95,
  ) {
    this.ollama = new OllamaClient(model);
  }

  async decideTurn(ctx: TurnContext): Promise<TurnDecision> {
    const revealed = ctx.gameState.getRevealedCellIndices();
    const hitProbs = ctx.particles.getHitProbabilities(revealed);
    const bestCellIndex = selectBestShot(hitProbs);

    if ((ctx.bridge.data.questionsRemaining as number) <= 0) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    const scored = await generateScoredQuestions(
      ctx.gameState,
      ctx.bridge.data,
      ctx.bridge.computed,
      ctx.particles.samples,
      ctx.askedQuestions,
      () => ctx.rng.next(),
      this.ollama,
      {
        totalCandidates: this.candidateQuestions,
        llmCandidates: this.llmCandidates,
        epsilon: ctx.epsilon,
        useLLM: true,
      },
    );

    const bestQuestion = scored[0];
    if (!bestQuestion) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    if (!shouldAskQuestion(bestQuestion, hitProbs, ctx.particles.samples, this.gamma, ctx.epsilon)) {
      return { action: "shoot", cellId: indexToCellId(bestCellIndex) };
    }

    const questionId = getQuestionId(bestQuestion);
    ctx.askedQuestions.add(questionId);
    return {
      action: "question",
      questionId,
      questionText: bestQuestion.text,
      evaluate: bestQuestion.evaluate,
    };
  }
}
