import { OllamaClient as AgentOllamaClient } from "../llm/ollama.js";
import { BayesLLMStrategy, BayesStrategy, GreedyStrategy, RandomStrategy } from "./bayes-strategies.js";
import { MPStrategy } from "./mp-strategy.js";
import { MStrategy } from "./m-strategy.js";
import { MMPStrategy } from "./mmp-strategy.js";
import { MRALLMStrategy, MRAStrategy } from "./mra/strategy.js";
import {
  createLiteMMPPolicy,
  createMCMCMMPPolicy,
  createOracleMMPPolicy,
  createPaperMMPPolicy,
} from "./mmp-policies.js";
import type { Strategy } from "./strategy.js";
import { WMAStrategy } from "./wma/strategy.js";
import { WMALLMSalvageStrategy } from "./wma/llm-salvage-strategy.js";

export type StrategyName =
  | "random"
  | "greedy"
  | "bayes"
  | "bayes-llm"
  | "m"
  | "mra"
  | "mra-llm"
  | "wma"
  | "wma-llm-salvage"
  | "mp"
  | "mmp"
  | "mmp-oracle"
  | "mmp-lite"
  | "mmp-mcmc";

export interface StrategyFactoryOptions {
  model: string;
  decisionModel?: string;
  explainModel?: string;
  candidateQuestions?: number;
  llmCandidates?: number;
  gamma?: number;
  targetQuestions?: number;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
  confidenceThreshold?: number;
  revisionCooldown?: number;
  revisionEnabled?: boolean;
  llmRevisionEnabled?: boolean;
  llmRevisionBudget?: number;
}

export function createStrategy(
  name: StrategyName,
  options: StrategyFactoryOptions,
): Strategy {
  const candidateQuestions = options.candidateQuestions ?? 10;
  const gamma = options.gamma ?? 0.95;

  switch (name) {
    case "random":
      return new RandomStrategy();
    case "greedy":
      return new GreedyStrategy();
    case "bayes":
      return new BayesStrategy(candidateQuestions, gamma);
    case "bayes-llm":
      return new BayesLLMStrategy(
        options.model,
        candidateQuestions,
        options.llmCandidates ?? 5,
        gamma,
      );
    case "m":
      return new MStrategy(candidateQuestions);
    case "mra":
      return new MRAStrategy(
        candidateQuestions,
        options.confidenceThreshold,
        options.revisionCooldown,
        options.revisionEnabled ?? true,
      );
    case "mra-llm":
      return new MRALLMStrategy(
        options.decisionModel ?? options.model,
        candidateQuestions,
        options.confidenceThreshold,
        options.revisionCooldown,
        options.revisionEnabled ?? true,
        options.llmRevisionEnabled ?? true,
        options.llmRevisionBudget ?? 999,
      );
    case "wma":
      return new WMAStrategy(candidateQuestions, options.targetQuestions ?? 12);
    case "wma-llm-salvage":
      return new WMALLMSalvageStrategy(
        options.decisionModel ?? "gemma4:e4b",
        options.explainModel,
        candidateQuestions,
        options.targetQuestions ?? 12,
        options.llmCandidates ?? 3,
      );
    case "mp":
      return new MPStrategy(new AgentOllamaClient(options.model));
    case "mmp":
      return new MMPStrategy(
        "mmp",
        createPaperMMPPolicy({
          targetQuestions: options.targetQuestions,
          coarseBudget: options.coarseBudget,
          localBudget: options.localBudget,
          lateBudget: options.lateBudget,
        }),
        options.model,
        candidateQuestions,
      );
    case "mmp-oracle":
      return new MMPStrategy(
        "mmp-oracle",
        createOracleMMPPolicy({
          targetQuestions: options.targetQuestions,
          coarseBudget: options.coarseBudget,
          localBudget: options.localBudget,
          lateBudget: options.lateBudget,
        }),
        options.model,
        candidateQuestions,
      );
    case "mmp-lite":
      return new MMPStrategy(
        "mmp-lite",
        createLiteMMPPolicy({
          targetQuestions: options.targetQuestions,
          coarseBudget: options.coarseBudget,
          localBudget: options.localBudget,
          lateBudget: options.lateBudget,
        }),
        options.model,
        candidateQuestions,
      );
    case "mmp-mcmc":
      return new MMPStrategy(
        "mmp-mcmc",
        createMCMCMMPPolicy({
          targetQuestions: options.targetQuestions,
          coarseBudget: options.coarseBudget,
          localBudget: options.localBudget,
          lateBudget: options.lateBudget,
        }),
        options.model,
        candidateQuestions,
      );
  }

  const unsupported: never = name;
  throw new Error(`Unknown strategy: ${unsupported}`);
}
