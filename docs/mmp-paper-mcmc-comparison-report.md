# MMP Paper Harness Comparison Report

**Date:** 2026-04-07  
**Scope:** `paper` protocol (`epsilon = 0.1`) on `all boards x 3 seeds` with `500` samples  
**Status:** Completed

---

## Summary

이번 비교의 결론은 두 줄로 요약된다.

- `MMP`는 `SMC` 위에서는 약했지만, `MCMC`로 올리자 `paper/noisy` 조건에서 실질적으로 경쟁력 있는 에이전트가 됐다.
- 다만 같은 `MCMC 500` 조건의 `M` baseline과 비교하면, `MMP-MCMC`는 평균 F1은 약간 낮고 승수는 더 높으며 질문 사용량은 압도적으로 적다.

즉 현재 상태의 해석은 다음이 맞다.

- 논문식 평균 F1 baseline: `M + MCMC`
- Manifesto extension candidate: `MMP + MCMC`

---

## Runs

이번 리포트는 아래 세 run을 비교한다.

1. Tuned `MMP` on `SMC`
   - run: `20260407-192550__mmp-smc__mmp-paper-tuned-full`
2. Tuned `MMP-MCMC`
   - run: `20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full`
3. `M` baseline on `MCMC`
   - run: `20260407-194550__m-mcmc__m-paper-mcmc-full`

근거는 전부 `log-lens`로 추출했다.

```bash
pnpm run log:lens -- --view run --run 20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full --format json
pnpm run log:lens -- --view compare --run 20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full --compare-run 20260407-192550__mmp-smc__mmp-paper-tuned-full --format json
pnpm run log:lens -- --view run --run 20260407-194550__m-mcmc__m-paper-mcmc-full --format json
pnpm run log:lens -- --view compare --run 20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full --compare-run 20260407-194550__m-mcmc__m-paper-mcmc-full --format json
```

---

## Aggregate Results

| Strategy | Belief | Avg F1 | Wins | Win Rate | Avg Shots | Avg Questions | LLM Turns | Runtime |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `mmp` | `smc` | `0.4509` | `8 / 54` | `14.8%` | `38.85` | `2.31` | `0` | `491.8s` |
| `mmp-mcmc` | `mcmc` | `0.5279` | `29 / 54` | `53.7%` | `35.65` | `1.11` | `0` | `455.1s` |
| `m` | `mcmc` | `0.5580` | `24 / 54` | `44.4%` | `33.85` | `15.00` | `0` | `166.9s` |

핵심 포인트:

- `MMP-MCMC`는 `MMP-SMC`를 큰 폭으로 이겼다.
- `MMP-MCMC`는 `M`보다 평균 F1은 낮지만, 승수는 더 많다.
- `MMP-MCMC`는 `M`보다 질문을 거의 쓰지 않는다.

---

## MMP-MCMC vs MMP-SMC

`MMP-MCMC`는 tuned `MMP-SMC` 대비 명확히 우세했다.

- `avgF1 +0.0770`
- `wins +21`
- `winRate +38.89pp`
- `avgShots -3.20`
- `avgQuestions -1.20`
- `runtime -36.7s`

가장 크게 개선된 보드:

- `B17`: `0.4198 -> 0.6920`
- `B13`: `0.3827 -> 0.5721`
- `B15`: `0.4815 -> 0.6397`
- `B16`: `0.3333 -> 0.4914`
- `B10`: `0.4321 -> 0.5610`

거의 개선이 없거나 약했던 보드:

- `B02`: `0.4784 -> 0.4790`
- `B06`: `0.4868 -> 0.4724`
- `B03`: `0.5296 -> 0.3951`

해석:

- `SMC`에서는 보수형 tuned `MMP`가 질문도 적고 성능도 낮은 상태로 수렴했다.
- 동일한 policy를 `MCMC` posterior 위에 올리자 승률과 평균 F1이 동시에 올라갔다.
- 현재 `MMP` 계열에서 실제 성능 병목은 gate보다 belief quality였다는 해석이 강하다.

---

## MMP-MCMC vs M Baseline

같은 `paper + epsilon 0.1 + MCMC 500` 조건에서 `M`과 직접 비교하면 결과는 더 미묘하다.

- `avgF1 -0.0301`
- `wins +5`
- `winRate +9.26pp`
- `avgShots +1.80`
- `avgQuestions -13.89`
- `runtime +288.2s`

즉 `MMP-MCMC`는:

- 평균 F1만 보면 아직 `M`에 못 미친다.
- 하지만 실제 승패에서는 더 많이 이긴다.
- 무엇보다 질문 비용을 `15.0 -> 1.11`로 줄였다.

강하게 좋아진 보드:

- `B15`: `0.4074 -> 0.6397`
- `B17`: `0.5419 -> 0.6920`
- `B10`: `0.4745 -> 0.5610`
- `B04`: `0.4583 -> 0.5447`
- `B13`: `0.4887 -> 0.5721`

반대로 `M`이 더 강했던 보드:

- `B08`: `0.7606` vs `0.5238`
- `B01`: `0.6131` vs `0.4074`
- `B03`: `0.5732` vs `0.3951`
- `B11`: `0.6955` vs `0.5423`
- `B02`: `0.6175` vs `0.4790`

해석:

- `M`은 noisy paper harness에서도 여전히 질문을 `15/15` 거의 고정으로 쓰며 평균 F1을 끌어올린다.
- `MMP-MCMC`는 질문을 거의 안 쓰는 대신 승수와 비용 구조에서 다른 trade-off를 만든다.
- 따라서 현재 `MMP-MCMC`는 `M`의 완전 대체라기보다, 저질문 Manifesto planning variant로 보는 편이 정확하다.

---

## Policy Outcome

이번 tuned `MMP-MCMC`의 행동 특징은 분명하다.

- `LLM turns = 0`
- `avgQuestions = 1.11`
- `avgShots = 35.65`
- `wins = 29 / 54`

즉 이번 tuning은 원래 noisy `MMP`의 문제였던 아래 항목을 사실상 제거했다.

- 과질문
- LLM latency 의존
- 애매한 미세 차이에 대한 과도한 adjudication

대신 생긴 새 trade-off는 이것이다.

- 질문을 너무 적게 써서 일부 보드에서 평균 F1이 `M`보다 밀린다.

현재 policy는 "실전 비용 정규화" 쪽으로는 성공했고, "논문식 평균 F1 최적화"는 아직 덜 됐다.

---

## Recommendation

현재 기준의 추천은 다음과 같다.

1. 논문 baseline 표의 기본 `M` 결과는 여전히 `M + MCMC`를 사용한다.
2. Manifesto extension 대표 에이전트는 `MMP-MCMC`로 둔다.
3. 다음 개선은 `LLM` 복귀가 아니라, `MMP-MCMC`에서 질문을 `1회` 수준에서 `2-4회` 수준으로 정밀하게 되살리는 방향으로 간다.
4. 특히 `B01`, `B02`, `B03`, `B08`, `B11` 같이 `M` 대비 크게 밀린 보드를 기준으로 selective-question policy를 튜닝하는 게 맞다.

지금 단계에서의 최종 평가는 이렇다.

- `MMP-SMC`: 보류
- `MMP-MCMC`: 채택 후보
- `M + MCMC`: 현재 평균 F1 baseline

---

## Sources

- `MMP-SMC` summary: [results/runs/20260407-192550__mmp-smc__mmp-paper-tuned-full/summary.json](../results/runs/20260407-192550__mmp-smc__mmp-paper-tuned-full/summary.json)
- `MMP-MCMC` summary: [results/runs/20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full/summary.json](../results/runs/20260407-193457__mmp-mcmc-mcmc__mmp-mcmc-tuned-full/summary.json)
- `M` summary: [results/runs/20260407-194550__m-mcmc__m-paper-mcmc-full/summary.json](../results/runs/20260407-194550__m-mcmc__m-paper-mcmc-full/summary.json)

