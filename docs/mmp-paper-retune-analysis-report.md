# MMP Paper Retune Analysis Report

**Date:** 2026-04-07  
**Scope:** `paper` protocol (`epsilon = 0.1`) after question-budget retune and noisy-answer likelihood tempering  
**Status:** Completed

---

## Summary

이번 retune의 결론은 명확하다.

- `MMP-MCMC`의 질문 사용량을 `1.11`에서 `5.0`으로 되살렸다.
- noisy answer를 planning과 posterior update 양쪽에서 같은 likelihood로 처리하도록 맞췄다.
- 그 결과, 현재 실험 surface에서는 `MMP-MCMC`가 `M + MCMC` baseline을 넘어섰다.

최종 수치:

- `MMP-MCMC`: `avgF1 = 0.5468`, `33 / 54 wins`, `avgQuestions = 5.0`
- `M + MCMC`: `avgF1 = 0.5249`, `24 / 54 wins`, `avgQuestions = 15.0`

즉 이번 retune 이후 기준점은 이렇게 정리된다.

- 현재 best performing agent on paper harness: `MMP-MCMC`
- 비용 최소화된 Manifesto planning variant: `MMP-MCMC`
- 질문 과다 baseline: `M + MCMC`

---

## What Changed

이번 retune은 두 축이다.

1. `MMP` 질문 정책 복구

- `targetQuestions` 기반 gate를 추가했다.
- `pre-first-hit` coarse explore cap을 유지하되, 전체 질문 목표를 `5-7` 수준으로 끌어올렸다.
- 결과적으로 `MMP-MCMC`는 더 이상 `0-1 questions`로 수렴하지 않고, full run에서 `avgQuestions = 5.0`을 기록했다.

2. noisy answer likelihood 공통화

- `observeAnswer()` 업데이트와 planning 시 `evaluateQuestion()`이 같은 noisy likelihood를 사용하도록 맞췄다.
- 이전에는 실제 belief update는 `epsilon`을 반영했지만, planning 쪽은 거의 hard split처럼 행동했다.
- 지금은 `answer-likelihood` helper를 중심으로 posterior update와 hypothetical reweighting이 같은 가정을 공유한다.

이 변경은 `M` baseline에도 영향을 준다. 따라서 이번 리포트의 baseline 비교는 반드시 retuned 이후 새 run을 기준으로 읽어야 한다.

---

## Lens Commands

이번 리포트는 raw log를 직접 읽지 않고 `log-lens`만 사용했다.

```bash
pnpm run log:lens -- --view run --run 20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full --format json
pnpm run log:lens -- --view run --run 20260407-221129__m-mcmc__m-paper-mcmc-retune-full --format json
pnpm run log:lens -- --view compare --run 20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full --compare-run 20260407-221129__m-mcmc__m-paper-mcmc-retune-full --format json
pnpm run log:lens -- --view compare --run 20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full --compare-run 20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full --format json
```

추가 sanity check:

```bash
pnpm run log:lens -- --view run --run 20260407-215747__mmp-mcmc-mcmc__mmp-mcmc-retune-all1 --format json
pnpm run log:lens -- --view compare --run 20260407-215747__mmp-mcmc-mcmc__mmp-mcmc-retune-all1 --compare-run 20260407-220124__m-mcmc__m-paper-mcmc-all1-retune-compare --format json
```

---

## Aggregate Results

| Strategy | Belief | Avg F1 | Wins | Win Rate | Avg Shots | Avg Questions | LLM Turns | Runtime |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `mmp-mcmc` | `mcmc` | `0.5468` | `33 / 54` | `61.1%` | `34.24` | `5.0` | `0` | `517.6s` |
| `m` | `mcmc` | `0.5249` | `24 / 54` | `44.4%` | `35.31` | `15.0` | `0` | `174.4s` |

Delta (`mmp-mcmc` minus `m`):

- `avgF1 +0.0219`
- `wins +9`
- `winRate +16.67pp`
- `avgShots -1.07`
- `avgQuestions -10`
- `runtime +343.3s`

핵심 해석:

- `MMP-MCMC`는 평균 F1과 승수 모두 `M`보다 높다.
- `MMP-MCMC`는 질문을 `10개` 덜 쓰고도 `M`보다 더 자주 이긴다.
- 대신 runtime 비용은 아직 크다.

---

## Improvement Over Previous MMP-MCMC

retune 이전의 `MMP-MCMC` full run:

- run: `20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full`
- `avgF1 = 0.5279`
- `wins = 29 / 54`
- `avgQuestions = 1.11`

retune 이후:

- run: `20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full`
- `avgF1 = 0.5468`
- `wins = 33 / 54`
- `avgQuestions = 5.0`

Delta:

- `avgF1 +0.0189`
- `wins +4`
- `winRate +7.41pp`
- `avgShots -1.41`
- `avgQuestions +3.89`

즉 이번 retune의 실질 효과는 다음이다.

- 질문을 되살린 것이 실제 성능 개선으로 이어졌다.
- `MMP`는 질문을 너무 적게 쓰던 실패 모드에서 벗어났다.
- `5 questions` 전후가 현재 noisy paper harness에서 현실적인 sweet spot 후보로 보인다.

---

## Seed-1 Sanity Check

`all boards x 1 seed` sanity check에서도 같은 방향의 신호가 나왔다.

- run: `20260407-215747__mmp-mcmc-mcmc__mmp-mcmc-retune-all1`
- `MMP-MCMC`: `avgF1 = 0.5548`, `12 / 18 wins`, `avgQuestions = 5.0`
- matched `M`: `avgF1 = 0.5442`, `9 / 18 wins`, `avgQuestions = 15.0`

이 sanity check는 full run 전에 "질문 5개 복구가 실제로 도움이 되는가"를 빠르게 확인하기 위한 것이었고, full run 결과와 방향이 일치했다.

---

## Board-Level Pattern

retuned `MMP-MCMC`에서 강했던 보드:

- `B11`: `3 / 3 wins`, `avgF1 = 0.6911`
- `B09`: `3 / 3 wins`, `avgF1 = 0.6656`
- `B14`: `3 / 3 wins`, `avgF1 = 0.6543`
- `B18`: `3 / 3 wins`, `avgF1 = 0.6217`
- `B08`: `2 / 3 wins`, `avgF1 = 0.5961`

retuned `MMP-MCMC`에서 약했던 보드:

- `B03`: `1 / 3 wins`, `avgF1 = 0.4052`
- `B16`: `1 / 3 wins`, `avgF1 = 0.4387`
- `B13`: `1 / 3 wins`, `avgF1 = 0.4516`
- `B06`: `1 / 3 wins`, `avgF1 = 0.4601`
- `B10`: `2 / 3 wins`, `avgF1 = 0.4862`

`M` baseline 대비 개선이 컸던 보드:

- `B11`: `0.4744 -> 0.6911`
- `B07`: `0.4444 -> 0.5420`
- `B14`: `0.5596 -> 0.6543`
- `B04`: `0.5049 -> 0.5892`
- `B12`: `0.4837 -> 0.5485`

반대로 `M`이 여전히 더 강한 보드:

- `B10`: `0.6331` vs `0.4862`
- `B06`: `0.5631` vs `0.4601`
- `B17`: `0.6699` vs `0.5826`
- `B13`: `0.5136` vs `0.4516`
- `B18`: `0.6456` vs `0.6217`

해석:

- 현재 `MMP-MCMC`는 특정 보드군에서 `M`보다 확실히 강하다.
- 약한 보드들도 남아 있지만, 이제 평균적으로는 `M`보다 앞선다.
- 다음 개선은 질문 수 자체보다 "어떤 질문 family를 언제 쓰는가"에 더 가까워 보인다.

---

## Interpretation

이번 retune 이후 판단은 이전과 달라졌다.

이전 판단:

- `M`이 평균 F1 baseline
- `MMP-MCMC`는 저질문 extension candidate

현재 판단:

- `MMP-MCMC`가 현재 paper harness에서 더 강한 agent다.
- `M`은 여전히 중요한 baseline이지만, best observed setting은 아니다.

이 변화는 단순 threshold 조정보다 더 구조적인 의미가 있다.

- `MMP`가 질문을 너무 안 하던 병목이 실제로 존재했다.
- noisy answer를 planning/update에서 일관되게 취급하는 게 중요했다.
- `MMP`는 question-starved 상태가 아니라, 제한된 수의 가치 높은 질문을 쓰는 상태에서 더 잘 작동한다.

---

## Recommendation

현재 기준의 우선순위는 다음이 맞다.

1. `MMP-MCMC`를 현재 paper harness의 주력 후보로 승격한다.
2. `M + MCMC`는 baseline으로 계속 유지한다.
3. 다음 개선은 질문 수를 더 늘리는 게 아니라, `5`를 중심으로 보드별로 `4-7` 사이에서 적응시키는 방향으로 간다.
4. 특히 `B03`, `B06`, `B10`, `B13`, `B16`, `B17`을 기준으로 question family selection을 튜닝하는 게 맞다.

현재 단계의 실무적 결론:

- `MMP-SMC`: 사실상 종료
- old `MMP-MCMC (q≈1)`: superseded
- retuned `MMP-MCMC (q=5)`: current best

---

## Sources

- retuned `MMP-MCMC` summary: [results/runs/20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full/summary.json](../results/runs/20260407-220241__mmp-mcmc-mcmc__mmp-mcmc-retune-full/summary.json)
- retuned `M` summary: [results/runs/20260407-221129__m-mcmc__m-paper-mcmc-retune-full/summary.json](../results/runs/20260407-221129__m-mcmc__m-paper-mcmc-retune-full/summary.json)
- previous `MMP-MCMC` summary: [results/runs/20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full/summary.json](../results/runs/20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full/summary.json)
- seed-1 sanity check: [results/runs/20260407-215747__mmp-mcmc-mcmc__mmp-mcmc-retune-all1/summary.json](../results/runs/20260407-215747__mmp-mcmc-mcmc__mmp-mcmc-retune-all1/summary.json)

