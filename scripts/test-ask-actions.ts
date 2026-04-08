import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";
import { TOTAL_SHIP_CELLS } from "../src/domain/types.js";

async function main() {
  const board = generateBoard(42);
  const { runtime } = createBattleshipRuntime(board);

  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, TOTAL_SHIP_CELLS));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.startTurn));

  const avail = runtime.getAvailableActions() as string[];
  const asks = avail.filter((a: string) => a.startsWith("ask"));
  console.log("Ask actions:", asks.length);
  console.log(asks);

  // Ask row A
  console.log("\nAsking row A...");
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.askRowA));
  const snap = runtime.getSnapshot();
  console.log("askedRowA:", (snap.data as any).askedRowA);
  console.log("questionsRemaining:", (snap.data as any).questionsRemaining);

  // askRowA should now be blocked
  const avail2 = runtime.getAvailableActions() as string[];
  console.log("askRowA available?", avail2.includes("askRowA"), "(should be false)");
  console.log("askRowB available?", avail2.includes("askRowB"), "(should be true)");
}
main().catch(console.error);
