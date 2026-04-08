/**
 * Ollama LLM provider.
 */
import type { LLMClient, ChatMessage } from "./client.js";

export class OllamaClient implements LLMClient {
  readonly name: string;

  constructor(
    private model: string = "gemma3:4b-it-qat",
    private baseUrl: string = "http://localhost:11434",
  ) {
    this.name = `ollama:${model}`;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { message: { content: string } };
    return data.message.content;
  }
}
