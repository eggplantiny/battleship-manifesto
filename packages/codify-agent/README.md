# `@battleship-manifesto/codify-agent`

Patch-first codify agent primitives for the Battleship Manifesto experiments.

Current scope:

- build structured patch prompts for policy-first adaptation
- build schema revision prompts for later governed structural rewrites
- parse JSON patch proposals into a typed surface

Non-goals for v0:

- direct LLM transport
- active MEL recompilation during a game
- runtime integration with the experiment harness

Design stance:

- patch-first
- schema-second
- legality stays in MEL
- codify proposals do not directly override action legality
