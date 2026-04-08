/**
 * Ollama LLM provider.
 */
import type { LLMClient, ChatMessage, LLMChatOptions } from "./client.js";

const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export class OllamaClient implements LLMClient {
  readonly name: string;

  constructor(
    private model: string = "gemma3:4b-it-qat",
    private baseUrl: string = DEFAULT_OLLAMA_BASE_URL,
  ) {
    this.name = `ollama:${model}`;
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: options.json ? "json" : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { message: { content: string } };
    return data.message.content;
  }
}
