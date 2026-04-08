import { createBattleshipRuntime } from "../src/domain/wire.js";
import { generateBoard } from "../src/board/generator.js";

async function main() {
  const board = generateBoard(42);
  const { runtime } = createBattleshipRuntime(board);
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.setupBoard, 14));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "A5"));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, 0, 4));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.shoot, "F3"));
  await runtime.dispatchAsync(runtime.createIntent(runtime.MEL.actions.recordHit, 5, 2));

  const snap = runtime.getSnapshot();
  const c = snap.computed as any;
  const d = snap.data as any;
  console.log("hitCount:", d.hitCount);
  console.log("hitsR0:", d.hitsR0, "hitsR5:", d.hitsR5);
  console.log("hitsC2:", d.hitsC2, "hitsC4:", d.hitsC4);
  console.log("maxRowHits:", c.maxRowHits);
  console.log("maxColHits:", c.maxColHits);
  console.log("hitConcentration:", c.hitConcentration);
  console.log("progress:", c.progress);
  console.log("boardValue:", c.boardValue);
}
main().catch(console.error);
