import type { LLMClient, LLMClientConfig, LLMProvider } from "./client.js";
import { OllamaClient } from "./ollama.js";
import { OpenAIClient } from "./openai.js";

const DEFAULT_PROVIDER: LLMProvider = "ollama";

export function createLLMClient(config: LLMClientConfig): LLMClient {
  const provider = config.provider ?? DEFAULT_PROVIDER;

  switch (provider) {
    case "ollama":
      return new OllamaClient(config.model, config.baseUrl);
    case "openai":
      return new OpenAIClient(config.model, config.baseUrl, config.apiKey);
    default: {
      const unsupported: never = provider;
      throw new Error(`Unsupported LLM provider: ${unsupported}`);
    }
  }
}
