/**
 * LLM client interface. All providers implement this.
 * Strategies depend on this interface, not on concrete providers.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClient {
  readonly name: string;
  chat(messages: ChatMessage[]): Promise<string>;
}
