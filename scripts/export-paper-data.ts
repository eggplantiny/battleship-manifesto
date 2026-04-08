import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type RunSummary = {
  runId: string;
  strategy: string | null;
  policy: string | null;
  protocol: string | null;
  belief: string | null;
  particles: number | null;
  avgF1: number;
  avgShots: number;
  avgQuestions: number;
  wins: number;
  completedGames: number;
  winRate: number;
  runtimeSeconds: number;
  llmTurns: number;
  llmRate: number;
};

type RegistryEntry = {
  key: string;
  label: string;
  phase: string;
  scope: string;
  threshold?: number;
  runId: string;
};

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = path.join(REPO_ROOT, "docs", "paper-data");

const REGISTRY: RegistryEntry[] = [
  {
    key: "phase1_mra_revision_off_all3",
    label: "mra revision-off",
    phase: "phase1",
    scope: "all3",
    runId: "20260408-151919__mra-mcmc__paper-mra-rev-off-all3",
  },
  {
    key: "phase1_mra_revision_on_all3",
    label: "mra revision-on",
    phase: "phase1",
    scope: "all3",
    runId: "20260408-155012__mra-mcmc__paper-mra-rev-on-all3-preview2",
  },
  {
    key: "phase2_greedy_mcmc_all3",
    label: "greedy + mcmc",
    phase: "phase2",
    scope: "all3",
    runId: "20260408-160720__greedy-mcmc__paper-greedy-mcmc-all3",
  },
  {
    key: "phase2_wma_all3",
    label: "wma",
    phase: "phase2",
    scope: "all3",
    runId: "20260408-160720__wma-mcmc__paper-wma-all3",
  },
  {
    key: "phase3_mra_llm_th00_all1quick",
    label: "mra-llm threshold 0.0",
    phase: "phase3",
    scope: "all1quick",
    threshold: 0.0,
    runId: "20260408-165009__mra-llm-mcmc__paper-mra-llm-th00-all1quick",
  },
  {
    key: "phase3_mra_llm_th05_all1quick",
    label: "mra-llm threshold 0.5",
    phase: "phase3",
    scope: "all1quick",
    threshold: 0.5,
    runId: "20260408-165527__mra-llm-mcmc__paper-mra-llm-th05-all1quick",
  },
  {
    key: "phase3_mra_llm_th072_all1quick",
    label: "mra-llm threshold 0.72",
    phase: "phase3",
    scope: "all1quick",
    threshold: 0.72,
    runId: "20260408-170041__mra-llm-mcmc__paper-mra-llm-th072-all1quick",
  },
  {
    key: "phase3_mra_llm_th10_all1quick",
    label: "mra-llm threshold 1.0",
    phase: "phase3",
    scope: "all1quick",
    threshold: 1.0,
    runId: "20260408-170638__mra-llm-mcmc__paper-mra-llm-th10-all1quick",
  },
  {
    key: "phase3_mra_llm_th00_all3",
    label: "mra-llm threshold 0.0",
    phase: "phase3",
    scope: "all3",
    threshold: 0.0,
    runId: "20260408-161830__mra-llm-mcmc__paper-mra-llm-th00-all3",
  },
  {
    key: "phase3_mra_llm_th10_all3",
    label: "mra-llm threshold 1.0",
    phase: "phase3",
    scope: "all3",
    threshold: 1.0,
    runId: "20260408-171721__mra-llm-mcmc__paper-mra-llm-th10-all3",
  },
];

const MAIN_TABLE_KEYS = [
  "phase2_greedy_mcmc_all3",
  "phase2_wma_all3",
  "phase1_mra_revision_off_all3",
  "phase1_mra_revision_on_all3",
  "phase3_mra_llm_th00_all3",
  "phase3_mra_llm_th10_all3",
] as const;

function runLens(runId: string): RunSummary {
  const result = spawnSync(
    "node",
    [
      "--experimental-strip-types",
      "--experimental-transform-types",
      "--loader",
      "./scripts/lib/resolve-ts-loader.mjs",
      "scripts/log-lens.ts",
      "--view",
      "run",
      "--run",
      runId,
      "--format",
      "json",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    },
  );

  if (result.status !== 0) {
    throw new Error(`log:lens failed for ${runId}\n${result.stderr || result.stdout}`);
  }

  return JSON.parse(result.stdout) as RunSummary;
}

function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replaceAll("\"", "\"\"")}"`;
  }
  return raw;
}

function toCsv<T extends Record<string, string | number | null | undefined>>(
  rows: T[],
  columns: (keyof T)[],
): string {
  const header = columns.map((column) => csvEscape(String(column))).join(",");
  const body = rows
    .map((row) => columns.map((column) => csvEscape(row[column])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function writeCsv(filename: string, rows: Record<string, string | number | null | undefined>[], columns: string[]) {
  writeFileSync(path.join(OUTPUT_DIR, filename), toCsv(rows, columns), "utf8");
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const summaries = new Map<string, RunSummary>();
  for (const entry of REGISTRY) {
    summaries.set(entry.runId, runLens(entry.runId));
  }

  const registryJson = REGISTRY.map((entry) => {
    const summary = summaries.get(entry.runId)!;
    return {
      ...entry,
      lensCommand: `npm run log:lens -- --view run --run ${entry.runId} --format json`,
      summary,
    };
  });
  writeFileSync(
    path.join(OUTPUT_DIR, "run-registry.json"),
    `${JSON.stringify(registryJson, null, 2)}\n`,
    "utf8",
  );

  const mainTableRows = MAIN_TABLE_KEYS.map((key) => {
    const entry = REGISTRY.find((candidate) => candidate.key === key)!;
    const summary = summaries.get(entry.runId)!;
    return {
      system: entry.label,
      runId: entry.runId,
      strategy: summary.strategy,
      policy: summary.policy,
      protocol: summary.protocol,
      belief: summary.belief,
      particles: summary.particles,
      avgF1: summary.avgF1.toFixed(4),
      wins: `${summary.wins}/${summary.completedGames}`,
      winRate: summary.winRate.toFixed(4),
      avgShots: summary.avgShots.toFixed(2),
      avgQuestions: summary.avgQuestions.toFixed(2),
      llmTurns: summary.llmTurns,
      llmRate: summary.llmRate.toFixed(4),
      runtimeSeconds: summary.runtimeSeconds.toFixed(3),
    };
  });
  writeCsv(
    "main-table-all3.csv",
    mainTableRows,
    [
      "system",
      "runId",
      "strategy",
      "policy",
      "protocol",
      "belief",
      "particles",
      "avgF1",
      "wins",
      "winRate",
      "avgShots",
      "avgQuestions",
      "llmTurns",
      "llmRate",
      "runtimeSeconds",
    ],
  );

  const phase1Rows = REGISTRY.filter((entry) => entry.phase === "phase1").map((entry) => {
    const summary = summaries.get(entry.runId)!;
    return {
      system: entry.label,
      runId: entry.runId,
      avgF1: summary.avgF1.toFixed(4),
      wins: `${summary.wins}/${summary.completedGames}`,
      winRate: summary.winRate.toFixed(4),
      avgShots: summary.avgShots.toFixed(2),
      avgQuestions: summary.avgQuestions.toFixed(2),
      llmTurns: summary.llmTurns,
      llmRate: summary.llmRate.toFixed(4),
    };
  });
  writeCsv(
    "phase1-revision-ablation-all3.csv",
    phase1Rows,
    ["system", "runId", "avgF1", "wins", "winRate", "avgShots", "avgQuestions", "llmTurns", "llmRate"],
  );

  const phase2Rows = REGISTRY.filter((entry) => entry.phase === "phase2").map((entry) => {
    const summary = summaries.get(entry.runId)!;
    return {
      system: entry.label,
      runId: entry.runId,
      avgF1: summary.avgF1.toFixed(4),
      wins: `${summary.wins}/${summary.completedGames}`,
      winRate: summary.winRate.toFixed(4),
      avgShots: summary.avgShots.toFixed(2),
      avgQuestions: summary.avgQuestions.toFixed(2),
      llmTurns: summary.llmTurns,
      llmRate: summary.llmRate.toFixed(4),
    };
  });
  writeCsv(
    "phase2-world-model-ablation-all3.csv",
    phase2Rows,
    ["system", "runId", "avgF1", "wins", "winRate", "avgShots", "avgQuestions", "llmTurns", "llmRate"],
  );

  const phase3Rows = REGISTRY.filter((entry) => entry.phase === "phase3").map((entry) => {
    const summary = summaries.get(entry.runId)!;
    return {
      scope: entry.scope,
      threshold: entry.threshold?.toFixed(2) ?? "",
      system: entry.label,
      runId: entry.runId,
      avgF1: summary.avgF1.toFixed(4),
      wins: `${summary.wins}/${summary.completedGames}`,
      winRate: summary.winRate.toFixed(4),
      avgShots: summary.avgShots.toFixed(2),
      avgQuestions: summary.avgQuestions.toFixed(2),
      llmTurns: summary.llmTurns,
      llmRate: summary.llmRate.toFixed(4),
      runtimeSeconds: summary.runtimeSeconds.toFixed(3),
    };
  });
  writeCsv(
    "phase3-llm-sweep-points.csv",
    phase3Rows,
    [
      "scope",
      "threshold",
      "system",
      "runId",
      "avgF1",
      "wins",
      "winRate",
      "avgShots",
      "avgQuestions",
      "llmTurns",
      "llmRate",
      "runtimeSeconds",
    ],
  );

  const readme = `# Paper Data

Generated from curated run ids using \`log:lens\` only.

Regenerate:

\`\`\`bash
pnpm paper:data
\`\`\`

Files:

- \`run-registry.json\`: machine-readable registry with run ids, experiment grouping, lens commands, and full run summaries.
- \`main-table-all3.csv\`: current main comparison table for the paper.
- \`phase1-revision-ablation-all3.csv\`: symbolic revision on/off comparison.
- \`phase2-world-model-ablation-all3.csv\`: \`wma\` vs \`greedy + mcmc\`.
- \`phase3-llm-sweep-points.csv\`: quick and selected threshold sweep points with measured \`llmRate\`.
`;
  writeFileSync(path.join(OUTPUT_DIR, "README.md"), readme, "utf8");

  console.log(`Wrote paper data artifacts to ${OUTPUT_DIR}`);
}

main();
