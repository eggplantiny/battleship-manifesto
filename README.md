# Battleship Manifesto

Battleship planning and reflective-agent experiments built on the public Manifesto packages.

This repo is organized as a **Manifesto example app**, not just a Battleship bot. The main progression is:

1. base game law in MEL
2. revealed world state in MEL
3. reflective prediction/confidence/revision state in MEL

The public strategy line built on top of that progression is:

- `greedy`: posterior argmax baseline
- `wma`: world-model planning
- `mra`: symbolic reflective self-revision
- `cra`: counterfactual preview-gated symbolic revision
- `mra-llm`: sparse LLM-guided revision on top of the same reflective runtime

## LLM Providers

LLM-capable strategies are no longer tied to Ollama. This repo now supports:

- `ollama`
- `openai`

Defaults:

- provider default: `ollama`
- Ollama URL default: `OLLAMA_BASE_URL` or `http://localhost:11434`
- OpenAI URL default: `OPENAI_BASE_URL` or `https://api.openai.com/v1`
- OpenAI API key: `OPENAI_API_KEY`

This means you can:

- keep using local Ollama
- point to a remote or Dockerized Ollama instance via `OLLAMA_BASE_URL`
- switch revision or decision paths to OpenAI via CLI flags

## Start Here

If you want to understand the repo quickly, read in this order:

1. [docs/manifesto-guide.md](./docs/manifesto-guide.md)
2. [src/domain/battleship.mel](./src/domain/battleship.mel)
3. [src/domain/battleship-world.mel](./src/domain/battleship-world.mel)
4. [src/domain/battleship-reflective.mel](./src/domain/battleship-reflective.mel)
5. [src/domain/wire.ts](./src/domain/wire.ts)
6. [src/runtime/bridge.ts](./src/runtime/bridge.ts)
7. [src/runtime/game-loop.ts](./src/runtime/game-loop.ts)
8. [src/strategies/wma/strategy.ts](./src/strategies/wma/strategy.ts)
9. [src/strategies/mra/strategy.ts](./src/strategies/mra/strategy.ts)

## Scope Note

This repository uses a **paper-like reimplementation** of noisy Collaborative Battleship:

- `8x8` board
- `14` total ship cells
- up to `40` shots
- up to `15` questions
- noisy answers with `epsilon = 0.1`

Important:

- this repo does **not** currently claim exact benchmark reproduction of Grand et al.
- the public experiment suite uses a deterministic synthetic `18`-board set
- current public examples commonly use `MCMC 500`

## Prerequisites

You need a recent Node.js runtime. This repo is currently tested with Node.js `25.9.0`.

If you do not have Node.js yet:

- install it from [nodejs.org](https://nodejs.org/)
- or use `nvm` and run `nvm use` in this repo after reading [`.nvmrc`](./.nvmrc)

You do **not** need to install `pnpm` globally. The easiest path is to use Node's bundled `corepack`.

## Quickstart

Enable `pnpm`, install dependencies, and typecheck:

```bash
corepack enable
pnpm install
pnpm check
```

If `corepack` is unavailable, you can also run:

```bash
npx pnpm@10.33.0 install
npx pnpm@10.33.0 check
```

Run a one-board smoke test:

```bash
pnpm run exp:run -- --strategy mra --revision-enabled true --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label smoke-mra-b17
```

Inspect the result:

```bash
pnpm run log:lens -- --view run --run latest
pnpm run log:lens -- --view confidence --run latest --game B17-seed0
```

## Common Runs

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

Reflective agent with sparse LLM revision:

```bash
pnpm run exp:run -- --strategy mra-llm --decision-model gemma4:e4b --model gemma4:e4b --confidence-threshold 1.0 --boards all --seeds 3 --protocol paper --belief mcmc --particles 500 --label mra-llm-all3
```

Reflective agent with OpenAI-backed revision:

```bash
OPENAI_API_KEY=... pnpm run exp:run -- --strategy mra-llm --llm-provider openai --decision-provider openai --decision-model gpt-4o-mini --confidence-threshold 1.0 --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label mra-openai-b17
```

World-model agent against a remote or Dockerized Ollama:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434 pnpm run exp:run -- --strategy wma-llm-salvage --decision-model gemma4:e4b --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label wma-remote-ollama-b17
```

Build the demo app:

```bash
pnpm build
```

## Log Analysis

Use the lens first.

Run summary:

```bash
pnpm run log:lens -- --view run --run <run-id-or-path>
```

Single game:

```bash
pnpm run log:lens -- --view game --run <run-id-or-path> --game <board-seed>
```

Reflective confidence trace:

```bash
pnpm run log:lens -- --view confidence --run <run-id-or-path> --game <board-seed>
```

LLM usage:

```bash
pnpm run log:lens -- --view llm --run <run-id-or-path>
```

Primary vs baseline comparison:

```bash
pnpm run log:lens -- --view compare --run <primary-run> --compare-run <baseline-run>
```

Per repository policy in [AGENTS.md](./AGENTS.md), raw run logs should not be the default analysis path.

## Manifesto Structure In This Repo

### Domain progression

- [src/domain/battleship.mel](./src/domain/battleship.mel)
  - base game law
- [src/domain/battleship-world.mel](./src/domain/battleship-world.mel)
  - revealed board state in MEL
- [src/domain/battleship-reflective.mel](./src/domain/battleship-reflective.mel)
  - prediction, confidence, and revision state in MEL

### Runtime seam

- [src/domain/wire.ts](./src/domain/wire.ts)
  - chooses which domain to activate
- [src/runtime](./src/runtime)
  - bridge, simulation, and game loop

### Supporting systems

- [src/belief](./src/belief)
  - particle/MCMC belief tracking
- [src/questions](./src/questions)
  - template questions and question DSL
- [src/strategies](./src/strategies)
  - current public strategy implementations
- [src/legacy](./src/legacy)
  - older prompt/parsing paths kept out of the main story

## Docs

- [docs/manifesto-guide.md](./docs/manifesto-guide.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/how-to-run.md](./docs/how-to-run.md)
- [docs/how-to-analyze.md](./docs/how-to-analyze.md)

## Packages

This repo uses the published Manifesto packages from npm, not a local linked core:

- `@manifesto-ai/sdk`
- `@manifesto-ai/lineage`
- `@manifesto-ai/compiler`
- `@manifesto-ai/codegen`
- `@manifesto-ai/skills`

## Current Status

Solid now:

- published Manifesto packages are wired in
- `wma`, `mra`, `cra`, and `mra-llm` all run from the same public CLI
- `log:lens` covers run, game, llm, compare, and confidence views

Still intentionally open:

- exact published-board benchmark matching
- larger-seed confirmation runs
- stronger LLM revision policies
- cross-episode codify integration
