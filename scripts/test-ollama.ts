/**
 * Test: Ollama LLM question generation
 */
import { OllamaClient } from "../src/agent/legacy-llm/ollama.js";
import { buildQuestionPrompt } from "../src/agent/legacy-llm/prompt.js";
import { parseLLMQuestions } from "../src/agent/legacy-llm/parse-response.js";
import { GameState } from "../src/domain/game-state.js";
import { generateBoard, boardToAscii } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";

async function main() {
  const model = process.argv[2] || "gemma4:e4b";
  console.log(`Model: ${model}\n`);
  const ollama = new OllamaClient(model);

  console.log("Checking Ollama...");
  if (!(await ollama.isAvailable())) {
    console.error("Ollama is not available!");
    process.exit(1);
  }
  console.log("Ollama is available.\n");

  // Create game state
  const board = generateBoard(42);
  console.log("True board:");
  console.log(boardToAscii(board, true));
  console.log();

  const gameState = new GameState(board);
  // Simulate some shots
  const cell1 = gameState.cells.get("A5")!;
  cell1.status = "hit";
  const cell2 = gameState.cells.get("A1")!;
  cell2.status = "miss";

  console.log("Captain's view:");
  console.log(gameState.toAscii());
  console.log();

  const snapshotData = {
    shotsFired: 2, hitCount: 1, missCount: 1,
    shotsRemaining: 38, questionsRemaining: 15,
    totalShipCells: TOTAL_SHIP_CELLS,
  };
  const snapshotComputed = {
    shipCellsRemaining: 13, hitRate: 0.5, progress: 0.071,
  };

  const prompt = buildQuestionPrompt(gameState, snapshotData, snapshotComputed, [], 5);
  console.log("Prompt length:", prompt.length, "chars\n");
  console.log("Sending to gemma4:e4b...\n");

  const startTime = Date.now();
  const response = await ollama.chat([{ role: "user", content: prompt }], true);
  const elapsed = Date.now() - startTime;

  console.log(`Response (${elapsed}ms):`);
  console.log(response);
  console.log();

  const questions = parseLLMQuestions(response);
  console.log(`Parsed ${questions.length} questions:`);
  for (const q of questions) {
    // Test evaluate function
    let evalResult: string;
    try {
      evalResult = String(q.evaluate(board));
    } catch (e) {
      evalResult = `ERROR: ${(e as Error).message}`;
    }
    console.log(`  "${q.text}" → evaluate(trueBoard) = ${evalResult}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
