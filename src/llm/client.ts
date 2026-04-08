/**
 * LLM client interface. All providers implement this.
 * Strategies depend on this interface, not on concrete providers.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMChatOptions {
  json?: boolean;
}

export interface LLMClient {
  readonly name: string;
  chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<string>;
}

export type LLMProvider = "ollama" | "openai";

export interface LLMClientConfig {
  provider?: LLMProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}
