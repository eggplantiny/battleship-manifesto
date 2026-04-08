import type { LLMClientConfig, LLMProvider } from "../llm/client.js";
import { createLLMClient } from "../llm/factory.js";
import { BayesLLMStrategy, BayesStrategy, GreedyStrategy, RandomStrategy } from "./bayes-strategies.js";
import { MPStrategy } from "./mp-strategy.js";
import { MStrategy } from "./m-strategy.js";
import { MMPStrategy } from "./mmp-strategy.js";
import { CRAStrategy, MRALLMStrategy, MRAStrategy } from "./mra/strategy.js";
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
  | "cra"
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
  llmProvider?: LLMProvider;
  llmBaseUrl?: string;
  llmApiKey?: string;
  decisionProvider?: LLMProvider;
  decisionBaseUrl?: string;
  decisionApiKey?: string;
  explainProvider?: LLMProvider;
  explainBaseUrl?: string;
  explainApiKey?: string;
  candidateQuestions?: number;
  llmCandidates?: number;
  gamma?: number;
  targetQuestions?: number;
  coarseBudget?: number;
  localBudget?: number;
  lateBudget?: number;
  confidenceThreshold?: number;
  revisionCooldown?: number;
  minRevisionDelta?: number;
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
  const defaultClientConfig: LLMClientConfig = {
    provider: options.llmProvider,
    model: options.model,
    baseUrl: options.llmBaseUrl,
    apiKey: options.llmApiKey,
  };

  switch (name) {
    case "random":
      return new RandomStrategy();
    case "greedy":
      return new GreedyStrategy();
    case "bayes":
      return new BayesStrategy(candidateQuestions, gamma);
    case "bayes-llm":
      return new BayesLLMStrategy(
        createLLMClient(defaultClientConfig),
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
        options.minRevisionDelta,
      );
    case "cra":
      return new CRAStrategy(
        candidateQuestions,
        options.confidenceThreshold,
        options.revisionCooldown,
        options.revisionEnabled ?? true,
        options.minRevisionDelta,
      );
    case "mra-llm":
      return new MRALLMStrategy(
        createRoleClient(defaultClientConfig, {
          provider: options.decisionProvider,
          model: options.decisionModel ?? options.model,
          baseUrl: options.decisionBaseUrl,
          apiKey: options.decisionApiKey,
        }),
        candidateQuestions,
        options.confidenceThreshold,
        options.revisionCooldown,
        options.revisionEnabled ?? true,
        options.llmRevisionEnabled ?? true,
        options.llmRevisionBudget ?? 999,
        options.minRevisionDelta,
        true,
      );
    case "wma":
      return new WMAStrategy(candidateQuestions, options.targetQuestions ?? 12);
    case "wma-llm-salvage":
      return new WMALLMSalvageStrategy(
        createRoleClient(defaultClientConfig, {
          provider: options.decisionProvider,
          model: options.decisionModel ?? "gemma4:e4b",
          baseUrl: options.decisionBaseUrl,
          apiKey: options.decisionApiKey,
        }),
        options.explainModel
          ? createRoleClient(defaultClientConfig, {
              provider: options.explainProvider,
              model: options.explainModel,
              baseUrl: options.explainBaseUrl,
              apiKey: options.explainApiKey,
            })
          : undefined,
        candidateQuestions,
        options.targetQuestions ?? 12,
        options.llmCandidates ?? 3,
      );
    case "mp":
      return new MPStrategy(createLLMClient(defaultClientConfig));
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

function createRoleClient(
  fallback: LLMClientConfig,
  override: LLMClientConfig,
) {
  return createLLMClient({
    provider: override.provider ?? fallback.provider,
    model: override.model,
    baseUrl: override.baseUrl ?? fallback.baseUrl,
    apiKey: override.apiKey ?? fallback.apiKey,
  });
}
