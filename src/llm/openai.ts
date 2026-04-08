import type { ChatMessage, LLMChatOptions, LLMClient } from "./client.js";

const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

type OpenAIMessageContent =
  | string
  | Array<
      | { type: "text"; text?: string | null }
      | Record<string, unknown>
    >;

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: OpenAIMessageContent | null;
    };
  }>;
}

export class OpenAIClient implements LLMClient {
  readonly name: string;

  constructor(
    private readonly model: string,
    private readonly baseUrl: string = DEFAULT_OPENAI_BASE_URL,
    private readonly apiKey: string | undefined = process.env.OPENAI_API_KEY,
  ) {
    this.name = `openai:${model}`;
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Missing OPENAI_API_KEY for OpenAI client");
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: options.json ? { type: "json_object" } : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as OpenAIChatResponse;
    return normalizeOpenAIContent(data.choices?.[0]?.message?.content);
  }
}

function normalizeOpenAIContent(content: OpenAIMessageContent | null | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((part) => part.type === "text" && typeof part.text === "string" ? [part.text] : [])
      .join("");
  }

  return "";
}
