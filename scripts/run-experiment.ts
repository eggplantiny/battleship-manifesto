/**
 * Legacy compatibility wrapper around the official v2 experiment runner.
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
    agent: { type: "string", default: "bayes" },
    protocol: { type: "string", default: "paper" },
    boards: { type: "string" },
    seeds: { type: "string" },
    particles: { type: "string" },
    belief: { type: "string" },
    epsilon: { type: "string" },
    gamma: { type: "string" },
    model: { type: "string", default: "gemma4:e4b" },
    verbose: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const strategyName = mapLegacyAgent(args.agent!);
  if (args.agent === "m-llm") {
    console.warn('run-experiment: "m-llm" is deprecated; routing to "mmp" as the nearest v2 strategy.');
  }

  const input = {
    strategyName,
    protocol: args.protocol as ProtocolName,
    boards: args.boards,
    seeds: parseOptionalInt(args.seeds),
    particles: parseOptionalInt(args.particles),
    belief: args.belief as BeliefKind | undefined,
    epsilon: parseOptionalFloat(args.epsilon),
    gamma: parseOptionalFloat(args.gamma),
    model: args.model!,
    onGameComplete: ({ boardId, seedIndex, result: game }) => {
      const status = game.won ? "WON" : "LOST";
      console.log(
        `${boardId} seed=${seedIndex}: ${status} | F1=${game.targetingF1.toFixed(3)} | shots=${game.shotsFired} hits=${game.hitCount} questions=${game.questionsAsked}`,
      );
    },
  };
  const preview = resolveStrategyExperimentOptions(input);

  console.log("=== Battleship Experiment ===");
  console.log(`Legacy agent: ${args.agent}`);
  console.log(`Strategy: ${preview.strategyName}`);
  console.log(`Protocol: ${preview.protocolName}`);
  console.log(`Boards: ${preview.boardIds.join(", ")}`);
  console.log(`Seeds per board: ${preview.seedCount}`);
  console.log(`Particles: ${preview.particleCount}`);
  console.log(`Belief: ${preview.beliefKind}`);
  console.log(`Epsilon: ${preview.epsilon}`);
  if (args.verbose) {
    console.log("Verbose mode is deprecated in the compatibility wrapper. Use log-lens for inspection.");
  }
  console.log();

  const result = await runStrategyExperiment(input);

  const { outputDir, results } = result;
  console.log(`\nLogs: ${outputDir}`);

  const avgF1 = results.length > 0
    ? results.reduce((sum, game) => sum + game.targetingF1, 0) / results.length
    : 0;
  const wins = results.filter((game) => game.won).length;
  const avgShots = results.length > 0
    ? results.reduce((sum, game) => sum + game.shotsFired, 0) / results.length
    : 0;
  const avgQuestions = results.length > 0
    ? results.reduce((sum, game) => sum + game.questionsAsked, 0) / results.length
    : 0;

  console.log("\n=== Summary ===");
  console.log(`Games: ${results.length}`);
  console.log(`Avg Targeting F1: ${avgF1.toFixed(3)}`);
  console.log(`Win Rate: ${(wins / Math.max(results.length, 1) * 100).toFixed(1)}% (${wins}/${results.length})`);
  console.log(`Avg Shots: ${avgShots.toFixed(1)}`);
  console.log(`Avg Questions: ${avgQuestions.toFixed(1)}`);
}

function mapLegacyAgent(agent: string): StrategyName {
  switch (agent) {
    case "random":
    case "greedy":
    case "bayes":
    case "bayes-llm":
    case "m":
    case "mp":
    case "mmp":
      return agent;
    case "m-llm":
      return "mmp";
    default:
      throw new Error(`Unsupported legacy agent: ${agent}`);
  }
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return Number.parseInt(raw, 10);
}

function parseOptionalFloat(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  return Number.parseFloat(raw);
}

main().catch((error) => {
  console.error("Experiment failed:", error);
  process.exit(1);
});
