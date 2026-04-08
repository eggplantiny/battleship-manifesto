# How To Analyze Runs

Use the log lens first.

## Run summary

```bash
pnpm run log:lens -- --view run --run <run-id-or-path>
```

## Single game

```bash
pnpm run log:lens -- --view game --run <run-id-or-path> --game <board-seed>
```

## Reflective confidence trace

```bash
pnpm run log:lens -- --view confidence --run <run-id-or-path> --game <board-seed>
```

## LLM usage

```bash
pnpm run log:lens -- --view llm --run <run-id-or-path>
```

## Compare runs

```bash
pnpm run log:lens -- --view compare --run <primary-run> --compare-run <baseline-run>
```

Per repository policy, avoid reading raw run logs directly unless the lens is missing a projection you need.
