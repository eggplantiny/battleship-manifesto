# LLM Setup

This guide explains how to run the LLM-backed strategies in this repository and where to hook in additional providers.

## When you need this

You only need LLM configuration for strategies that actually call a model, such as:

- `bayes-llm`
- `mp`
- `mra-llm`
- `wma-llm-salvage`

You do not need API access for `greedy`, `wma`, `mra`, or `cra`.

## Supported providers

The current public providers are:

- `ollama`
- `openai`

Provider defaults:

- default provider: `ollama`
- default Ollama base URL: `http://localhost:11434`
- default OpenAI base URL: `https://api.openai.com/v1`
- OpenAI auth env var: `OPENAI_API_KEY`

## Shared CLI rules

The runner exposes one fallback LLM config plus role-specific overrides.

- `--model`
  fallback model for any LLM role that does not set a role-specific model
- `--llm-provider`
  fallback provider for all LLM roles
- `--llm-base-url`
  fallback base URL for all LLM roles
- `--decision-model`, `--decision-provider`, `--decision-base-url`
  overrides for the decision or revision path
- `--explain-model`, `--explain-provider`, `--explain-base-url`
  overrides for the explanation path used by `wma-llm-salvage`

In practice:

- `mra-llm` mainly cares about the decision or revision role
- `wma-llm-salvage` can use separate decision and explanation models

## Ollama

Start Ollama and make sure the model you want is available, for example:

```bash
ollama pull gemma4:e4b
```

If Ollama is local, the default URL is enough. Run a one-board smoke test like this:

```bash
pnpm run exp:run -- --strategy mra-llm --decision-provider ollama --decision-model gemma4:e4b --confidence-threshold 1.0 --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label mra-llm-ollama-b17
```

If Ollama is running elsewhere, point the runner at it:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434 pnpm run exp:run -- --strategy wma-llm-salvage --decision-provider ollama --decision-model gemma4:e4b --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label wma-remote-ollama-b17
```

Replace `host.docker.internal` with the actual host and port in your environment.

## OpenAI

Export an API key first:

```bash
export OPENAI_API_KEY=YOUR_KEY_HERE
```

Then run an OpenAI-backed smoke test:

```bash
pnpm run exp:run -- --strategy mra-llm --decision-provider openai --decision-model gpt-4o-mini --confidence-threshold 1.0 --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label mra-openai-b17
```

If you need a non-default OpenAI endpoint, set `OPENAI_BASE_URL` or pass `--decision-base-url`.

The current OpenAI client expects a `/chat/completions` endpoint with bearer-token auth.

## Mixed role configuration

If a strategy uses more than one LLM role, you can keep a global default and override only one role. For example, this keeps Ollama as the fallback while routing the decision path to OpenAI:

```bash
OPENAI_API_KEY=YOUR_KEY_HERE pnpm run exp:run -- --strategy wma-llm-salvage --llm-provider ollama --model gemma4:e4b --decision-provider openai --decision-model gpt-4o-mini --explain-provider ollama --explain-model gemma4:e4b --boards B17 --seeds 1 --protocol paper --belief mcmc --particles 500 --label wma-mixed-b17
```

## Inspect model usage

After a run finishes, inspect LLM activity with the lens:

```bash
pnpm run log:lens -- --view llm --run latest
```

## Adding another provider

If you want to integrate a new provider in code, the seam is intentionally small:

1. implement `LLMClient` in `src/llm/client.ts`
2. add the provider in `src/llm/factory.ts`
3. thread any new auth or endpoint settings through `scripts/run-v2.ts`
4. use the provider via `src/strategies/create-strategy.ts`

That keeps strategy code provider-neutral.
