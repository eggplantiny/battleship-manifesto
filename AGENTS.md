# AGENTS.md

## Constitution

- When analyzing experiment results, run outcomes, or agent behavior in this repository, use the log lens CLI first:
  - `npm run log:lens -- --view run --run <run-id-or-path>`
  - `npm run log:lens -- --view game --run <run-id-or-path> --game <game-id>`
  - `npm run log:lens -- --view llm --run <run-id-or-path>`
  - `npm run log:lens -- --view compare --run <primary-run> --compare-run <baseline-run>`
- Do not read raw `results/runs/*/events.jsonl` or `games/*.json` wholesale for analysis by default.
- Raw log inspection is allowed only when the lens is insufficient, and then only through narrow, explicitly justified slices such as `rg`, `sed`, or `tail`.
- If the lens is missing a needed projection, extend `scripts/log-lens.ts` rather than normalizing direct raw-log reads.
- When reporting log-derived conclusions, prefer citing the exact lens command used.
