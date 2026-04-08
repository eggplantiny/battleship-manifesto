# Manifesto Guide

This guide explains how to read this repository as a Manifesto example project.

The short version:

- MEL owns the game law, world state, and reflective control state.
- TypeScript owns belief tracking, candidate scoring, and host-side orchestration.
- The repo is organized to show a progression:
  - base domain
  - world-state domain
  - reflective domain

## The Main Idea

This repository is not just a Battleship bot. It is a staged example of how more agent structure can be moved into a Manifesto runtime.

Read the project as three layers:

1. `src/domain`
   - what the world is allowed to do
   - what state exists
   - what computed signals exist
2. `src/runtime`
   - how the host activates the domain and executes turns
   - how `sim.next()`-style evaluation is exposed
3. `src/strategies`
   - how different agents use the same runtime surface

## The MEL Progression

The cleanest way to understand the repo is to read the MEL files in order.

### 1. Base domain

[battleship.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship.mel)

This is the smallest domain:

- core game counters
- action legality
- base board value and progression

Use this file to understand the minimum Battleship rules.

### 2. World-state domain

[battleship-world.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-world.mel)

This domain moves the revealed board into MEL.

New idea:

- revealed cells are now runtime state inside the domain
- `shoot` dispatchability can depend on actual revealed-cell state
- planning can simulate over a richer declared world

This is the domain used by `WMA`.

### 3. Reflective domain

[battleship-reflective.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-reflective.mel)

This domain adds prediction and revision state.

New idea:

- predicted action/outcome fields
- confidence tracking
- revision eligibility and revision presets
- policy-mode state inside the runtime

This is the domain used by `MRA` and `MRA-LLM`.

## What Stays In MEL vs TypeScript

### MEL owns

- domain legality
- action availability / dispatchability
- revealed world state
- reflective state such as prediction, confidence, and revision mode
- policy knobs that are part of the declared runtime state

### TypeScript owns

- belief backends such as particle and MCMC logic
- candidate scoring math
- host-side game execution
- experiment harness and logging
- provider-neutral LLM transport and parsing

This split is intentional. The current public story is not “everything is in MEL.” It is “the important runtime protocol is declared explicitly, and TypeScript becomes a thinner orchestration layer.”

## Runtime Seam

Start here:

- [wire.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/wire.ts)
- [bridge.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/runtime/bridge.ts)
- [game-loop.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/runtime/game-loop.ts)

What these files show:

- `wire.ts`
  - selects which MEL domain to activate
  - exposes base, world, and reflective runtimes
- `bridge.ts`
  - wraps the activated Manifesto runtime
  - exposes snapshot, legality, and simulation-friendly helpers
- `game-loop.ts`
  - translates strategy decisions into runtime actions
  - resolves shots and questions against the host-side board

If you want to understand how Manifesto is used in the app, these are the first TypeScript files to read.

## Strategy Progression

The repo keeps several strategy lines, but the public progression is:

### `greedy`

- posterior argmax shot selection
- baseline for “belief only”

### `wma`

- world-model agent
- uses the richer world-state MEL domain
- planning improves over pure posterior argmax

Main file:

- [wma/strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/strategies/wma/strategy.ts)

### `mra`

- reflective agent
- records predictions, updates confidence, and applies symbolic revision
- does not require LLM calls

Main file:

- [mra/strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/strategies/mra/strategy.ts)

### `mra-llm`

- same reflective runtime
- LLM is used only as a sparse revision resource

The important point is that `MRA-LLM` is not a separate architecture. It is the same reflective protocol with a narrower LLM role.

## Belief and Questions

Two subsystems remain outside MEL for now.

### Belief

- [src/belief](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/belief)

This contains:

- belief interfaces
- particle logic
- MCMC logic
- hit-probability and expected-gain utilities

### Questions

- [src/questions](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/questions)

This contains:

- template questions
- question DSL (`QuestionSpec`)
- question compilation and validation

The repo currently uses Manifesto for runtime protocol, not for all belief/question generation logic.

## LLM Transport

The current LLM seam is provider-neutral.

- strategies depend on [`LLMClient`](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/llm/client.ts), not on Ollama directly
- provider selection happens in [`factory.ts`](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/llm/factory.ts)
- both strategy-side LLM usage and Manifesto effect-side LLM usage now share the same client factory

The current public providers are:

- `ollama`
- `openai`

## Recommended Reading Order

If you want the fastest path to understanding the repo, use this order:

1. [README.md](/home/eggp/dev/workspaces/experiments/battleship-manifesto/README.md)
2. [battleship.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship.mel)
3. [battleship-world.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-world.mel)
4. [battleship-reflective.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-reflective.mel)
5. [wire.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/wire.ts)
6. [bridge.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/runtime/bridge.ts)
7. [wma/strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/strategies/wma/strategy.ts)
8. [mra/strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/strategies/mra/strategy.ts)

## How To Extend It

If you want to add a new Manifesto-native capability, the order is usually:

1. add state / computed / actions to a MEL domain
2. expose or activate that domain in `wire.ts`
3. update the runtime seam if host interaction changes
4. update a strategy to consume the new runtime surface
5. validate behavior through `log:lens`

That sequence is the intended development loop for this repo.
