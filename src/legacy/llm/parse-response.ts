/**
 * Parse LLM responses: extract questions and evaluate functions.
 */
import type { Board } from "../../domain/types.js";

export interface ParsedQuestion {
  id?: string;
  family?: string;
  text: string;
  evaluate: (board: Board) => boolean;
}

/**
 * Parse LLM JSON response into questions with evaluate functions.
 * Falls back gracefully on parse errors.
 */
export function parseLLMQuestions(response: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];

  try {
    // Try to extract JSON array from response
    let parsed: Array<{ text: string; eval: string }>;

    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      parsed = JSON.parse(arrayMatch[0]);
    } else {
      // Single object or wrapped in { "questions": [...] }
      const obj = JSON.parse(response);
      if (Array.isArray(obj)) {
        parsed = obj;
      } else if (obj.questions && Array.isArray(obj.questions)) {
        parsed = obj.questions;
      } else if (obj.text && obj.eval) {
        parsed = [obj];
      } else {
        return questions;
      }
    }

    for (const item of parsed) {
      if (!item.text || !item.eval) continue;

      try {
        // Safely create the evaluate function
        const evalFn = createEvalFunction(item.eval);
        if (evalFn) {
          questions.push({ text: item.text, evaluate: evalFn });
        }
      } catch {
        // Skip invalid evaluate functions
      }
    }
  } catch {
    // JSON parse failed — return empty
  }

  return questions;
}

/**
 * Create an evaluate function from a JS string.
 * Validates it's safe (no side effects) before executing.
 */
function createEvalFunction(code: string): ((board: Board) => boolean) | null {
  // Basic safety check — reject obviously dangerous code
  const forbidden = ["import", "require", "fetch", "eval(", "Function(", "process", "global", "window"];
  for (const keyword of forbidden) {
    if (code.includes(keyword)) return null;
  }

  try {
    // Wrap in a function factory
    const factory = new Function("return " + code) as () => (board: Board) => boolean;
    const fn = factory();

    // Test that it's callable
    if (typeof fn !== "function") return null;

    return fn;
  } catch {
    return null;
  }
}
