/**
 * Diagnostic: check Bayes decision making
 */
import { loadBoard } from "../src/board/boards.js";
import { ParticleSet } from "../src/agent/particles.js";
import { selectBestShot, computeEIG, shouldAskQuestion, maxHitProb } from "../src/agent/bayes.js";
import { selectTemplateQuestions } from "../src/agent/questions/template-questions.js";
import { indexToCellId } from "../src/domain/types.js";
import { SeededRandom } from "../src/board/generator.js";
import { boardToAscii } from "../src/board/generator.js";

const board = loadBoard("B01");
console.log("True board:");
console.log(boardToAscii(board, true));
console.log();

const particles = new ParticleSet(200, 42);
const rng = new SeededRandom(99);

// Score template questions
const templates = selectTemplateQuestions(40, new Set(), () => rng.next());
const scored = templates.map((q) => ({
  text: q.text,
  evaluate: q.evaluate,
  eig: computeEIG(q.evaluate, particles.particles, 0),
}));
scored.sort((a, b) => b.eig - a.eig);

console.log("Top 10 questions by EIG:");
for (const q of scored.slice(0, 10)) {
  console.log(`  EIG=${q.eig.toFixed(4)}  ${q.text}`);
}

// Hit probs
const hitProbs = particles.getHitProbabilities(new Set());
const topCells = [...hitProbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log("\nTop 5 cells by hit prob:");
for (const [idx, prob] of topCells) {
  console.log(`  ${indexToCellId(idx)}  p=${prob.toFixed(4)}`);
}

console.log("\nMax hit prob:", maxHitProb(hitProbs).toFixed(4));
console.log("ESS:", particles.getESS().toFixed(1));

// D_Bayes decision
const bestQ = scored[0];
const ask = shouldAskQuestion(bestQ, hitProbs, particles.particles, 0.95, 0);
console.log(`\nD_Bayes: should ask "${bestQ.text}"?`, ask);

// Simulate asking the question
console.log("\n--- After asking best question (answer = true/false) ---");
const pYes = particles.particles.reduce(
  (s, p) => s + (bestQ.evaluate(p.board) ? p.weight : 0), 0
);
console.log("P(yes):", pYes.toFixed(4));
