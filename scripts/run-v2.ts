/**
 * Official experiment runner.
 *
 * Defaults to the paper-matched CaptainQA protocol:
 * - all boards
 * - 3 seeds
 * - 500 particles
 * - SMC belief
 * - epsilon 0.1
 */
import { parseArgs } from "node:util";
import type { BeliefKind } from "../src/agent/belief-state.js";
import type { StrategyName } from "../src/agent/strategies/create-strategy.js";
import {
  resolveStrategyExperimentOptions,
  runStrategyExperiment,
  type ProtocolName,
} from "./lib/run-strategy-experiment.js";

const cliArgs = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));

const { values: args } = parseArgs({
  args: cliArgs,
  options: {
    strategy: { type: "string", default: "bayes" },
    protocol: { type: "string", default: "paper" },
    boards: { type: "string" },
    seeds: { type: "string" },
    particles: { type: "string" },
    belief: { type: "string" },
    epsilon: { type: "string" },
    gamma: { type: "string" },
    "target-questions": { type: "string" },
    "coarse-budget": { type: "string" },
    "local-budget": { type: "string" },
    "late-budget": { type: "string" },
    "confidence-threshold": { type: "string" },
    "revision-cooldown": { type: "string" },
    "revision-enabled": { type: "string" },
    "llm-revision-enabled": { type: "string" },
    "llm-revision-budget": { type: "string" },
    model: { type: "string", default: "gemma4:e4b" },
    "decision-model": { type: "string" },
    "explain-model": { type: "string" },
    label: { type: "string" },
    "log-dir": { type: "string", default: "results/runs" },
  },
});

async function main(): Promise<void> {
  const input = {
    strategyName: args.strategy as StrategyName,
    protocol: args.protocol as ProtocolName,
    boards: args.boards,
    seeds: parseOptionalInt(args.seeds),
    particles: parseOptionalInt(args.particles),
    belief: args.belief as BeliefKind | undefined,
    epsilon: parseOptionalFloat(args.epsilon),
    gamma: parseOptionalFloat(args.gamma),
    targetQuestions: parseOptionalInt(args["target-questions"]),
    coarseBudget: parseOptionalInt(args["coarse-budget"]),
    localBudget: parseOptionalInt(args["local-budget"]),
    lateBudget: parseOptionalInt(args["late-budget"]),
    confidenceThreshold: parseOptionalFloat(args["confidence-threshold"]),
    revisionCooldown: parseOptionalInt(args["revision-cooldown"]),
    revisionEnabled: parseOptionalBoolean(args["revision-enabled"]),
    llmRevisionEnabled: parseOptionalBoolean(args["llm-revision-enabled"]),
    llmRevisionBudget: parseOptionalInt(args["llm-revision-budget"]),
    model: args.model!,
    decisionModel: args["decision-model"],
    explainModel: args["explain-model"],
    label: args.label,
    logDir: args["log-dir"]!,
    onGameComplete: ({ boardId, seedIndex, result: game }) => {
      const status = game.won ? "WON" : "LOST";
      console.log(
        `${boardId} seed=${seedIndex}: ${status} | F1=${game.targetingF1.toFixed(3)} | shots=${game.shotsFired} hits=${game.hitCount} q=${game.questionsAsked}`,
      );
    },
  };
  const preview = resolveStrategyExperimentOptions(input);

  console.log("=== Battleship v2 ===");
  console.log(`Protocol: ${preview.protocolName}`);
  console.log(
    `Strategy: ${preview.strategyName}, Belief: ${preview.beliefKind}, Boards: ${preview.boardIds.length}, Seeds: ${preview.seedCount}, Particles: ${preview.particleCount}, Epsilon: ${preview.epsilon}\n`,
  );

  const result = await runStrategyExperiment(input);

  const { outputDir, results } = result;

  console.log(`\nLogs: ${outputDir}`);

  const avgF1 = results.length > 0
    ? results.reduce((sum, game) => sum + game.targetingF1, 0) / results.length
    : 0;
  const wins = results.filter((game) => game.won).length;
  console.log("\n=== Summary ===");
  console.log(`Games: ${results.length}`);
  console.log(`Avg F1: ${avgF1.toFixed(3)}`);
  console.log(`Win Rate: ${results.length > 0 ? (wins / results.length * 100).toFixed(1) : "0.0"}% (${wins}/${results.length})`);
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return Number.parseInt(raw, 10);
}

function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return Number.parseFloat(raw);
}

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid boolean value: ${raw}`);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
