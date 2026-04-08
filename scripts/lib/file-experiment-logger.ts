import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ExperimentLogger,
  ExperimentRunMeta,
  ExperimentRunSummary,
  GameLogEvent,
  GameLogger,
  GameLogMeta,
  GameLogSummary,
} from "../../src/experiment/logging.js";

interface StoredGameEvent extends GameLogEvent {
  index: number;
  loggedAt: string;
}

export function createRunId(strategyName: string, label?: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    "-",
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
    now.getSeconds().toString().padStart(2, "0"),
  ].join("");

  const parts = [stamp, slugify(strategyName)];
  if (label) parts.push(slugify(label));
  return parts.join("__");
}

export function createFileExperimentLogger(
  meta: ExperimentRunMeta,
  outputRoot: string = "results/runs",
): ExperimentLogger {
  const outputDir = resolve(outputRoot, meta.runId);
  const gamesDir = resolve(outputDir, "games");
  const gamesIndexPath = resolve(outputDir, "games.jsonl");
  const eventsIndexPath = resolve(outputDir, "events.jsonl");

  mkdirSync(gamesDir, { recursive: true });
  writeJson(resolve(outputDir, "run.json"), { ...meta, outputDir });
  const counters = {
    llmTurns: 0,
    autoDecidedTurns: 0,
    fallbackTurns: 0,
  };

  return {
    runId: meta.runId,
    outputDir,
    startGame(gameMetaInput) {
      const gameMeta: GameLogMeta = {
        runId: meta.runId,
        ...gameMetaInput,
      };
      const events: StoredGameEvent[] = [];
      let eventIndex = 0;
      const gameFileName = [
        String(gameMeta.gameIndex + 1).padStart(3, "0"),
        slugify(gameMeta.boardId),
        `seed${gameMeta.seedIndex}`,
      ].join("__") + ".json";
      const gameFilePath = resolve(gamesDir, gameFileName);

      return {
        meta: gameMeta,
        log(event) {
          const storedEvent: StoredGameEvent = {
            ...event,
            index: eventIndex++,
            loggedAt: new Date().toISOString(),
          };
          events.push(storedEvent);
          if (event.type === "gate_decision" && isRecord(event.data)) {
            if (event.data.usedLLM === true) counters.llmTurns += 1;
            if (event.data.usedLLM === false) counters.autoDecidedTurns += 1;
          }
          if (event.type === "reflective_llm_revision_requested") {
            counters.llmTurns += 1;
          }
          if (event.type === "fallback") {
            counters.fallbackTurns += 1;
          }
          appendJsonLine(eventsIndexPath, {
            runId: meta.runId,
            gameId: gameMeta.gameId,
            boardId: gameMeta.boardId,
            seed: gameMeta.seed,
            seedIndex: gameMeta.seedIndex,
            ...storedEvent,
          });
        },
        close(summary) {
          appendJsonLine(gamesIndexPath, {
            runId: meta.runId,
            gameId: gameMeta.gameId,
            gameIndex: gameMeta.gameIndex,
            seedIndex: gameMeta.seedIndex,
            status: "completed",
            ...summary,
          });
          writeJson(gameFilePath, {
            meta: gameMeta,
            status: "completed",
            summary,
            events,
          });
        },
        abort(error) {
          appendJsonLine(gamesIndexPath, {
            runId: meta.runId,
            gameId: gameMeta.gameId,
            gameIndex: gameMeta.gameIndex,
            seedIndex: gameMeta.seedIndex,
            boardId: gameMeta.boardId,
            seed: gameMeta.seed,
            strategyName: gameMeta.strategyName,
            policyName: gameMeta.policyName,
            status: "failed",
            error,
          });
          writeJson(gameFilePath, {
            meta: gameMeta,
            status: "failed",
            error,
            events,
          });
        },
      } satisfies GameLogger;
    },
    close(summary) {
      const runtimeSeconds = Math.max(
        0,
        (Date.parse(summary.finishedAt) - Date.parse(meta.startedAt)) / 1000,
      );
      const finalSummary: ExperimentRunSummary = {
        ...summary,
        runtimeSeconds,
        llmTurns: counters.llmTurns,
        autoDecidedTurns: counters.autoDecidedTurns,
        fallbackTurns: counters.fallbackTurns,
        outputDir,
      };
      writeJson(resolve(outputDir, "summary.json"), finalSummary);
    },
  };
}

function appendJsonLine(path: string, value: object): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
}

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "run";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
