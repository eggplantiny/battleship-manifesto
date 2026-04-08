# Manifesto Usage Survey

## Project Context

- Project: `battleship-manifesto`
- Date: `2026-04-08`
- Evaluator: Codex
- Manifesto packages / versions:
  - `@manifesto-ai/sdk 3.7.0`
  - `@manifesto-ai/lineage 3.6.0`
  - `@manifesto-ai/compiler 3.3.0`
  - `@manifesto-ai/codegen 0.2.5`
  - `@manifesto-ai/skills ^1.0.0`
- Main use cases:
  - declared Battleship domain modeling
  - world-state planning
  - reflective in-episode self-revision
  - sparse LLM-guided revision
- Main constraints:
  - experiment-heavy codebase
  - public example repo expectations
  - need for runtime traceability and safety

## Scorecard

| Category | Score / 10 | One-line Summary | What Worked Well | What Felt Weak |
|---|---:|---|---|---|
| Declarative modeling power | 9.5 | The strongest part of the experience | Base law, world state, and reflective state fit naturally into MEL progression | Belief math still needs careful TS boundary decisions |
| Agent / metacognition expressivity | 9.0 | Strong enough to make reflective agents feel native | `prediction -> confidence -> revision` fit well as state/computed/actions | Revision policy still requires deliberate MEL vs TS scoping |
| Introspection and debugging | 9.0 | Runtime state is visible instead of implicit | Snapshot, schema graph, dispatchability, and lens-friendly state are excellent | There are many surfaces, so newcomers need guidance |
| Host-runtime boundary clarity | 8.5 | Clear and useful when kept disciplined | MEL owns protocol, TS owns belief/orchestration; this split held up well | Effect path and strategy path can drift into duplication |
| Safety / guardrails | 8.5 | Very good for agent experiments | Guarded actions and explicit runtime state reduce hidden failure modes | Fast informal hacking is less convenient than ad hoc TS |
| Extensibility / composability | 8.5 | Good layering model | Base -> world -> reflective domains compose cleanly | If repo structure is loose, complexity grows quickly |
| LLM integration flexibility | 7.5 | Good after refactoring | `LLMClient` seam allows provider-neutral clients and sparse LLM roles | Early versions coupled too directly to Ollama and duplicated seams |
| API / DX consistency | 7.5 | Mostly coherent, with room to tighten | Activation-first runtime and legality/introspection seams are easy to reason about | Multiple runtime/effect/strategy seams can feel like too many choices |
| Documentation / learning curve | 7.0 | Improving, but still technical | Public seams are now explainable through guide docs and repo layout | New users still need to learn MEL, host/runtime, and analysis flow together |
| User onboarding | 6.5 | Fine for researchers, still rough for casual users | README and guide now provide a real reading order | Node/pnpm/Ollama/provider setup is still a noticeable hurdle |
| Performance / experiment iteration speed | 7.0 | Good on symbolic paths, slower with LLMs | Pure symbolic reflective runs are viable and useful | Larger sweeps still take meaningful time |
| Public example suitability | 8.5 | Strong once the repo is curated | MEL progression tells a compelling story and matches the framework well | Legacy/scratch clutter hurts first impressions fast |

## Overall Summary

- Overall score: `8.2 / 10`
- Best part: Declarative runtime structure makes agent architecture visible and inspectable
- Weakest part: Onboarding and seam duplication still need active design discipline
- Best fit:
  - agent/runtime research
  - explicit world models
  - reflective or metacognitive agent protocols
  - systems that benefit from legality and snapshot-level introspection
- Poor fit:
  - tiny scripts that need maximum speed and minimum abstraction
  - teams that want zero learning curve
  - projects where the host/runtime boundary is not worth making explicit

## Detailed Notes

### Good

- The MEL progression is genuinely strong:
  - `battleship.mel`
  - `battleship-world.mel`
  - `battleship-reflective.mel`
- Reflective control became runtime state instead of hidden strategy code.
- `dispatchable`, schema graph inspection, and snapshot access made debugging substantially easier.
- The framework made it possible to push a lot of agent structure out of the LLM and into explicit runtime protocol.

### Bad

- Choosing what belongs in MEL versus TypeScript remains a real design cost.
- Without an intentional repo structure, experiment code grows messy quickly.
- Early LLM integration paths can duplicate each other unless a shared seam is enforced.
- Newcomers still need setup help before they reach the interesting ideas.

### Improved Recently

- `Record<string, T>` and nullable support improve reflective state modeling.
- Public seams are clearer than before.
- Provider-neutral LLM integration is now feasible through a shared `LLMClient` path.
- Skill/docs quality improved from “reference text” toward “working guidance.”

### Highest-Leverage Next Improvements

- Keep reducing seam duplication between strategies and effect handlers.
- Make provider setup and containerized onboarding easier for first-time users.
- Continue improving public docs with one-path examples and fewer historical leftovers.
- Keep default repo structure tightly curated so the framework story stays visible.

## Short External Summary

Manifesto feels less like a convenience framework and more like a framework for making agent structure explicit. In this project, that was a major strength: world modeling, reflective control, and guarded runtime behavior became visible state instead of hidden strategy code. The tradeoff is that it demands more design discipline, especially around MEL-versus-TypeScript boundaries and public repo hygiene, but for explicit agent/runtime research it is a strong substrate.
