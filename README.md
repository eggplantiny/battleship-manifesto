# Battleship Manifesto

Battleship planning and reflective-agent experiments built on top of the public Manifesto runtime packages.

This repository currently focuses on four agent families:

- `greedy`: posterior argmax baseline
- `wma`: world-model planning with revealed state in MEL
- `mra`: symbolic reflective self-revision without LLM calls
- `mra-llm`: the same reflective loop with sparse LLM-guided revision

## What This Repo Is

This is a paper-like reimplementation of the noisy Collaborative Battleship setup:

- `8x8` board
- `14` total ship cells
- up to `40` shots
- up to `15` questions
- noisy answers with `epsilon = 0.1`

Important scope note:

- this repo does **not** currently claim exact benchmark reproduction of Grand et al.
- the public experiment suite uses a deterministic synthetic `18`-board set
- the current paper tables are primarily reported with `MCMC 500`

So the right reading is: this repo is a protocol and systems study in a controlled reimplementation setting.

## Requirements

- Node.js `25+`
- `pnpm`

## Quickstart

Install dependencies:

```bash
pnpm install
```

Typecheck the project:

```bash
pnpm check
```

Run a one-board smoke test:

```bash
pnpm run exp:run -- --strategy mra --revision-enabled true --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label smoke-mra-b17
```

Inspect the run with the log lens:

```bash
pnpm run log:lens -- --view run --run latest
pnpm run log:lens -- --view confidence --run latest --game B17-seed0
```

## Main Entry Points

Official experiment runner:

```bash
pnpm run exp:run -- --strategy <strategy> --protocol paper
```

Useful examples:

```bash
pnpm run exp:run -- --strategy greedy --protocol paper --belief mcmc --particles 500
pnpm run exp:run -- --strategy wma --protocol paper --belief mcmc --particles 500
pnpm run exp:run -- --strategy mra --protocol paper --belief mcmc --particles 500 --revision-enabled true
pnpm run exp:run -- --strategy mra-llm --protocol paper --belief mcmc --particles 500 --decision-model gemma4:e4b --model gemma4:e4b --confidence-threshold 1.0
```

Frontend/demo build:

```bash
pnpm build
```

## Log Analysis

Use the lens first. This repo treats `scripts/log-lens.ts` as the analysis surface.

Run-level summary:

```bash
pnpm run log:lens -- --view run --run <run-id-or-path>
```

Single-game inspection:

```bash
pnpm run log:lens -- --view game --run <run-id-or-path> --game <board-seed>
```

LLM usage:

```bash
pnpm run log:lens -- --view llm --run <run-id-or-path>
```

Primary vs baseline comparison:

```bash
pnpm run log:lens -- --view compare --run <primary-run> --compare-run <baseline-run>
```

For reflective agents:

```bash
pnpm run log:lens -- --view confidence --run <run-id-or-path> --game <board-seed>
```

By repository policy in [AGENTS.md](./AGENTS.md), raw run logs should not be the default analysis path.

## Strategies

### `greedy`

Chooses the highest posterior hit-probability shot. This is the cleanest `MCMC posterior argmax` baseline.

### `wma`

Moves revealed board state into MEL and uses `sim.next()`-style planning over that declared world model.

### `mra`

Adds a symbolic reflective loop:

- record a prediction
- observe the actual outcome
- update confidence
- revise policy when confidence stays low

This path does not need LLM calls.

### `mra-llm`

Keeps the same reflective runtime, but lets the LLM participate only in low-confidence revision steps. This is the main path for measuring how much LLM a self-revising agent actually needs.

## Manifesto Packages

This repo uses the published Manifesto packages from npm, not a local linked core:

- `@manifesto-ai/sdk`
- `@manifesto-ai/lineage`
- `@manifesto-ai/compiler`
- `@manifesto-ai/codegen`
- `@manifesto-ai/skills`

## Repository Layout

- [src/agent](./src/agent): strategies, pipelines, question DSL, LLM integration
- [src/domain](./src/domain): MEL domains and runtime wiring
- [scripts](./scripts): experiment runner, log lens, and export utilities
- [docs](./docs): public analysis notes and reports
- [packages/codify-agent](./packages/codify-agent): patch-first codify package for future cross-episode revision work

## Current Status

What is solid right now:

- published Manifesto packages are wired in
- `wma`, `mra`, and `mra-llm` all run from the same public CLI
- log-lens covers run, game, llm, compare, and confidence views

What is still intentionally open:

- exact published-board benchmark matching
- larger-seed confirmation runs
- stronger LLM revision policies
- cross-episode codify integration
