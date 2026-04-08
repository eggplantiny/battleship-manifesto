# How To Run

## Install

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

## One-board smoke

```bash
pnpm run exp:run -- --strategy mra --revision-enabled true --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label smoke-mra-b17
```

## LLM provider configuration

Defaults:

- provider: `ollama`
- Ollama URL: `OLLAMA_BASE_URL` or `http://localhost:11434`
- OpenAI URL: `OPENAI_BASE_URL` or `https://api.openai.com/v1`
- OpenAI key: `OPENAI_API_KEY`

Use local or remote Ollama:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434 pnpm run exp:run -- --strategy wma-llm-salvage --decision-model gemma4:e4b --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label wma-ollama-b17
```

Use OpenAI for the revision path:

```bash
OPENAI_API_KEY=... pnpm run exp:run -- --strategy mra-llm --llm-provider openai --decision-provider openai --decision-model gpt-4o-mini --confidence-threshold 1.0 --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label mra-openai-b17
```

## Common runs

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
