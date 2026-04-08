# Architecture Overview

This repository is structured to make the Manifesto progression explicit.

## 1. Domain progression

Read the MEL domains in order:

- `src/domain/battleship.mel`
  - base game rules and legality
- `src/domain/battleship-world.mel`
  - revealed world state moved into MEL
- `src/domain/battleship-reflective.mel`
  - prediction, confidence, and in-episode revision state

These three files are the core conceptual story of the project.

## 2. Runtime seam

The TypeScript runtime is intentionally thin around the MEL domains.

- `src/domain/wire.ts`
  - chooses which MEL domain to activate
- `src/runtime/bridge.ts`
  - app-facing Manifesto bridge and legality helpers
- `src/runtime/game-loop.ts`
  - execution of shots and questions
- `src/runtime/simulation*.ts`
  - hypothetical evaluation via `sim.next()`

## 3. Belief and questions

- `src/belief`
  - particle/MCMC belief tracking and scoring utilities
- `src/questions`
  - question templates and question DSL compilation

These stay outside MEL for now, while MEL owns legality, world state, and reflective control state.

## 4. Strategies

The public strategy progression is:

- `greedy`
  - posterior argmax baseline
- `wma`
  - world-model planning
- `mra`
  - symbolic reflective self-revision
- `mra-llm`
  - sparse LLM-guided revision on top of the same reflective runtime

Legacy strategy lines are preserved under the current source tree, but the main public story is `WMA -> MRA`.
