# How To Run Experiments

This guide is the reproduction path for external readers who want to run the public Battleship experiments from this repository.

## 1. Install

This repo is currently tested with Node.js `25.9.0`.

If you do not have Node.js yet:

- install it from `https://nodejs.org/`
- or use `nvm` and run `nvm use` in the repo root

You do not need a global `pnpm` install. Use `corepack`:

```bash
corepack enable
pnpm install
pnpm check
```

If `corepack` is unavailable, use:

```bash
npx pnpm@10.33.0 install
npx pnpm@10.33.0 check
```

## 2. Start with a no-LLM smoke test

This is the fastest way to confirm that the repo runs end to end:

```bash
pnpm run exp:run -- --strategy mra --revision-enabled true --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label smoke-mra-b17
```

That command writes a run directory under `results/runs/`.

## 3. Inspect the run with the lens

Use the repository-standard lens rather than raw logs:

```bash
pnpm run log:lens -- --view run --run latest
pnpm run log:lens -- --view confidence --run latest --game B17-seed0
```

The policy in `AGENTS.md` is to use `log:lens` first for run analysis.

## 4. Run the public comparison suite

These commands use the public paper-like setup that is pinned in the docs:

- all boards
- 3 seeds
- `protocol paper`
- `belief mcmc`
- `particles 500`

Greedy baseline:

```bash
pnpm run exp:run -- --strategy greedy --boards all --seeds 3 --protocol paper --belief mcmc --particles 500 --label greedy-all3
```

World-model planner:

```bash
pnpm run exp:run -- --strategy wma --boards all --seeds 3 --protocol paper --belief mcmc --particles 500 --label wma-all3
```

Reflective symbolic agent:

```bash
pnpm run exp:run -- --strategy mra --revision-enabled true --boards all --seeds 3 --protocol paper --belief mcmc --particles 500 --label mra-all3
```

Counterfactual reflective baseline:

```bash
pnpm run exp:run -- --strategy cra --revision-enabled true --min-revision-delta 0.01 --boards all --seeds 3 --protocol paper --belief mcmc --particles 500 --label cra-all3
```

## 5. Compare runs

Use the compare view to line up a primary run against a baseline:

```bash
pnpm run log:lens -- --view compare --run <primary-run> --compare-run <baseline-run>
```

## 6. Understand runner defaults

The CLI itself defaults to `--protocol paper`, which means:

- all boards
- 3 seeds
- 500 particles
- `smc` belief
- `epsilon 0.1`

The public commands in this repo pin `--belief mcmc --particles 500` explicitly so readers can rerun the documented setup without guessing.

## 7. Build the demo app

If you also want the browser demo:

```bash
pnpm build
```

## 8. If you want LLM-backed strategies

Use [docs/llm-setup.md](./llm-setup.md) for:

- `ollama` setup
- `openai` setup
- role-specific flags such as `--decision-provider`
- provider extension points in code
