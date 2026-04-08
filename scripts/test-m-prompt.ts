import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";
import { GameState } from "../src/domain/game-state.js";
import { buildManifestoPrompt } from "../src/agent/legacy-llm/prompt.js";
import { OllamaClient } from "../src/agent/legacy-llm/ollama.js";
import { parseLLMQuestions } from "../src/agent/legacy-llm/parse-response.js";

async function main() {
  const board = generateBoard(42);
  const { runtime, gameState } = createBattleshipRuntime(board);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A5"));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A1"));

  const prompt = buildManifestoPrompt(runtime, gameState, [], 5);
  console.log("=== MANIFESTO PROMPT ===");
  console.log(prompt);
  console.log("\n=== LENGTH:", prompt.length, "chars ===\n");

  // Test with LLM
  const ollama = new OllamaClient("gemma3:4b-it-qat");
  console.log("Sending to gemma3:4b-it-qat...");
  const start = Date.now();
  const response = await ollama.chat([{ role: "user", content: prompt }], true);
  console.log(`Response (${Date.now() - start}ms):`);
  console.log(response);

  const questions = parseLLMQuestions(response);
  console.log(`\nParsed ${questions.length} questions:`);
  for (const q of questions) {
    let result: string;
    try { result = String(q.evaluate(board)); } catch (e) { result = `ERR: ${(e as Error).message}`; }
    console.log(`  "${q.text}" → ${result}`);
  }
}

main().catch(console.error);
