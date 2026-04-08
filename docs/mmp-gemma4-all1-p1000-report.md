# MMP Gemma4 All-Boards Report

**Date:** 2026-04-07  
**Run:** `20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2`  
**Scope:** `MMP` strategy with `MCMC` belief, `gemma4:e4b`, `all boards × 1 seed × 1000 particles`  
**Status:** Completed

---

## Summary

이번 run에서 `MMP`는 `18`게임 중 `15`승을 기록했다.

- `avgF1 = 0.6876`
- `winRate = 83.3% (15/18)`
- `llmTurns = 242`
- `autoDecidedTurns = 498`
- `fallbackTurns = 1`

공식 summary:

- [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2/run.json)
- [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2/summary.json)

이 결과는 이전 `M` 단독 baseline보다 강하다. 다만 이 run은 여전히 `epsilon = 0` oracle Spotter 조건이며, 논문의 noisy Spotter 조건과는 다르다.

---

## Setup

실행 명령:

```bash
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy mmp --boards all --seeds 1 --particles 1000 --model gemma4:e4b --label mmp-gemma4-all1-p1000-v2
```

설정:

- strategy: `mmp`
- belief: `mcmc`
- model: `gemma4:e4b`
- particles: `1000`
- boards: `18`
- seeds per board: `1`
- epsilon: `0`

runtime:

- started: `2026-04-07T09:05:01.100Z`
- finished: `2026-04-07T09:25:14.099Z`
- wall-clock: `1213.0s` (`20m 13s`)

---

## Aggregate Results

`log-lens run` 기준 최종 집계:

- `games = 18`
- `avgF1 = 0.6876356321547017`
- `wins = 15 / 18`
- `winRate = 0.8333333333333334`
- `llmTurns = 242`
- `autoDecidedTurns = 498`
- `fallbackTurns = 1`

`games.jsonl` 기준 추가 집계:

- `avgShots = 27.28`
- `avgQuestions = 13.83`
- `avgHits = 13.61`
- `avgMisses = 13.67`
- `maxQuestions = 15`
- `minQuestions = 12`

근거:

- [games.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2/games.jsonl)

승리/패배 게임을 나누면 차이가 뚜렷했다.

- wins:
  - `15 games`
  - `avgF1 = 0.7387`
  - `avgShots = 24.73`
  - `avgQuestions = 13.93`
- losses:
  - `3 games`
  - `avgF1 = 0.4321`
  - `avgShots = 40.0`
  - `avgQuestions = 13.33`

즉 실패는 질문 부족보다도, 질문 이후에도 posterior가 충분히 sharpen되지 않아 `40 shots`를 다 쓰는 형태에 가깝다.

---

## Board-Level Pattern

가장 강한 보드:

- `B05`: `F1 = 0.9032`, `WON`, `shots = 17`, `questions = 14`
- `B11`: `F1 = 0.9032`, `WON`, `shots = 17`, `questions = 13`
- `B07`: `F1 = 0.8485`, `WON`, `shots = 19`, `questions = 13`
- `B06`: `F1 = 0.8235`, `WON`, `shots = 20`, `questions = 13`
- `B17`: `F1 = 0.8235`, `WON`, `shots = 20`, `questions = 12`

가장 약한 보드:

- `B12`: `F1 = 0.3704`, `LOST`, `shots = 40`, `questions = 12`
- `B14`: `F1 = 0.4444`, `LOST`, `shots = 40`, `questions = 15`
- `B16`: `F1 = 0.4815`, `LOST`, `shots = 40`, `questions = 13`
- `B13`: `F1 = 0.5385`, `WON`, `shots = 38`, `questions = 15`
- `B10`: `F1 = 0.5833`, `WON`, `shots = 34`, `questions = 12`

해석:

- 강한 보드는 질문으로 posterior를 빠르게 압축한 뒤 `20 shots` 안팎에서 마무리했다.
- 약한 보드는 질문을 거의 다 써도 후반 shoot precision이 충분히 올라오지 않았다.
- `B13`은 이기긴 했지만 `38 shots / 15 questions`라 비용이 크다.

---

## LLM Usage

`log-lens llm` 기준:

- `totalLLMTurns = 242`
- `avgLatencyMs = 4208.12`
- `p95LatencyMs = 5763`
- `avgLLMTurnsPerGame = 13.44`

전체 turn은 `740`이었다.

- `llm share = 32.7%`
- `auto share = 67.3%`

평균 latency를 단순 합산하면 LLM 응답 대기 시간은 약 `1018.4s`다. 이는 전체 wall-clock의 약 `84%`에 해당한다.

즉 현재 `MMP`는 구조적으로는 conditional LLM effect를 달성했지만, 비용 면에서는 아직 **LLM-bound system**이다.

LLM 사용이 많았던 게임:

- `B02`: `16 turns`
- `B03`: `16 turns`
- `B14`: `16 turns`
- `B04`: `15 turns`, `fallback = 1`
- `B11`: `15 turns`

주된 gate reason은 전부 `ambiguous_tradeoff`였다.  
즉 현재 gate는 “명확하면 자동, 애매하면 LLM” 구조는 지키지만, 실제 애매 구간 판정이 아직 넓다.

근거:

- [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2/summary.json)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-180501__mmp-mcmc__mmp-gemma4-all1-p1000-v2/events.jsonl)

---

## Comparison With M Baseline

공정한 최소 비교선을 위해, 기존 `M + MCMC + 1000` run에서 `seedIndex = 0`인 `18`게임만 추출해 비교했다.

baseline source:

- [games.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-174346__m-mcmc__m-default-all3-p1000/games.jsonl)

비교 결과:

| Metric | `M` seed0 subset | `MMP` | Delta |
|---|---:|---:|---:|
| Avg F1 | `0.5750` | `0.6876` | `+0.1127` |
| Wins | `9 / 18` | `15 / 18` | `+6` |
| Win Rate | `50.0%` | `83.3%` | `+33.3pp` |
| Avg Shots | `32.89` | `27.28` | `-5.61` |
| Avg Questions | `15.00` | `13.83` | `-1.17` |

이 비교에서 `MMP`는 `18`개 보드 중 `13`개에서 `M`보다 F1이 높았다.

개선 폭이 큰 보드:

- `B05`: `0.4444 -> 0.9032`
- `B17`: `0.4444 -> 0.8235`
- `B02`: `0.3333 -> 0.6667`
- `B03`: `0.4074 -> 0.7179`
- `B09`: `0.4444 -> 0.7179`

반대로 내려간 보드:

- `B12`: `0.4074 -> 0.3704`
- `B01`: `0.7568 -> 0.7000`
- `B14`: `0.5385 -> 0.4444`
- `B15`: `0.8750 -> 0.7778`
- `B08`: `0.8750 -> 0.7368`

핵심 해석:

- `MMP`는 단순히 질문을 더 많이 써서 이긴 게 아니다.
- 오히려 `M`보다 평균 질문 수가 조금 적고, 평균 shot 수는 크게 줄였다.
- 성능 개선은 “좋은 질문을 더 잘 골라 posterior를 더 빨리 압축했다”는 쪽에 가깝다.

다만 이 비교는 별도 공식 matched run이 아니라 기존 `M all3` 결과에서 `seed0`만 필터링한 분석이다.

---

## Interpretation

이번 run의 결론은 명확하다.

1. `MMP`는 이제 실제 성능 면에서도 유효하다.
2. `M` 대비 평균 F1과 win rate가 모두 눈에 띄게 상승했다.
3. 질문을 거의 매 게임에서 적극적으로 쓰되, 이전 `M`보다 질문을 더 많이 쓰지는 않았다.
4. 구조적으로 의도한 `conditional LLM effect`는 유지됐지만, 비용은 아직 높다.

즉 현재 `MMP`는:

- 구조: 성공
- 성능: 유망, 실질 개선 확인
- 비용: 아직 무거움
- 논문 재현 충실도: 아직 oracle 조건

---

## Limitations

### 1. Oracle Spotter

현재 run은 `epsilon = 0`이다. 논문 CaptainQA의 `BSC(ε=0.1)` 조건과 다르다.

### 2. Single Seed

이번 공식 `MMP` run은 `all boards × 1 seed`다.  
성능 신호는 강하지만, `3 seeds` 이상 repeatability check는 아직 없다.

### 3. LLM Cost

LLM이 전체 turn의 `32.7%`에서 사용됐고, wall-clock의 대부분을 차지했다.  
정책 품질은 좋아졌지만, 아직 cheap policy는 아니다.

### 4. Artifact Polish

현재 repo는 실험 코드는 강해졌지만, `README`와 `pnpm build` 상태는 아직 author-facing artifact 수준이 아니다.

---

## Next Steps

다음 우선순위는 이 순서가 맞다.

1. `MMP + all boards × 3 seeds × 1000` repeatability run
2. `epsilon = 0.1` noisy Spotter를 실제 runtime에 연결한 CaptainQA run
3. `late-game llm suppression` 또는 gate tightening으로 `llmTurns` 감소
4. `M`, `MMP`, `random`, `greedy`, `bayes`를 같은 harness 표로 정리

현재 상태를 한 줄로 요약하면:

**`MMP`는 구조 실험을 넘어서 실제 성능 개선까지 보였지만, 아직 paper-matched noisy setting과 cost optimization은 남아 있다.**
