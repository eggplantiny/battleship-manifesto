# M Belief Backend Comparison Report

**Date:** 2026-04-07  
**Scope:** `M` strategy with `SMC` vs `MCMC` belief backends  
**Status:** Implemented and matched-baseline validated through `all boards × 3 seeds`

---

## Summary

`M` 전략이 belief backend를 교체 가능하도록 공통 `BeliefState` seam 위로 올렸다.  
현재는 두 backend를 지원한다.

- `smc`: 기존 `ParticleSet`
- `mcmc`: 새 `MCMCBeliefState`

CLI에서도 바로 비교 가능하다. 현재 기본값은 `mcmc`다.

```bash
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy m --belief smc ...
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy m --belief mcmc ...
```

구현 위치:

- belief interface: [src/agent/belief-state.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/belief-state.ts#L1)
- belief factory: [src/agent/belief-factory.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/belief-factory.ts#L1)
- MCMC backend: [src/agent/mcmc-belief.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/mcmc-belief.ts#L1)
- SMC backend: [src/agent/particles.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/particles.ts#L1)
- runner wiring: [src/agent/runner.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/runner.ts#L18)
- CLI wiring: [scripts/run-v2.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/scripts/run-v2.ts#L19)

---

## Backend Design

### SMC

기존 방식 그대로다.

- weighted particles
- shot observation은 hard elimination
- question answer는 likelihood reweight
- ESS 기준 systematic resampling

### MCMC

새 backend는 posterior board samples를 uniform-weight sample set으로 노출한다.

- chain state는 single valid board
- proposal은 “ship 하나를 다른 valid placement로 이동”
- shot observation은 hard constraint
- question answer는 likelihood
- burn-in 이후 thinning 하며 `sampleCount`개 posterior sample 수집

현재 default:

- `burnIn = max(200, sampleCount * 2)`
- `thin = 5`
- `proposalRetries = 50`

---

## Results

### 1. Single-Board Smoke

설정:

- board: `B01`
- seeds: `1`
- samples: `200`

SMC:

- run: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172719__m-smc__m-smc-smoke/summary.json)
- `F1 = 0.407`
- `winRate = 0`

MCMC:

- run: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172719__m-mcmc__m-mcmc-smoke/summary.json)
- `F1 = 0.333`
- `winRate = 0`

단일 보드에서는 `MCMC`가 더 좋지 않았다.

### 2. All Boards x 1 Seed

설정:

- boards: `all` (`18`)
- seeds: `1`
- samples: `100`

SMC:

- run: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172739__m-smc__m-smc-all1-p100/summary.json)
- `avgF1 = 0.4044`
- `wins = 2 / 18`
- `winRate = 11.1%`

MCMC:

- run: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172739__m-mcmc__m-mcmc-all1-p100/summary.json)
- `avgF1 = 0.5730`
- `wins = 8 / 18`
- `winRate = 44.4%`

즉 `all boards × 1 seed × 100 samples`에서는 `MCMC`가 `SMC`보다 명확히 좋았다.

### 3. All Boards x 3 Seeds

설정:

- boards: `all` (`18`)
- seeds: `3`
- samples: `500`
- belief: `smc` vs `mcmc`

결과:

- SMC run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173853__m-smc__m-smc-all3-p500/run.json)
- SMC run summary: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173853__m-smc__m-smc-all3-p500/summary.json)
- SMC per-game logs: [games.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173853__m-smc__m-smc-all3-p500/games.jsonl)
- run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173156__m-mcmc__m-mcmc-all3-p500/run.json)
- run summary: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173156__m-mcmc__m-mcmc-all3-p500/summary.json)
- per-game logs: [games.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173156__m-mcmc__m-mcmc-all3-p500/games.jsonl)
- `games = 54` each

SMC:

- `avgF1 = 0.4391`
- `wins = 7 / 54`
- `winRate = 13.0%`

MCMC:

- `avgF1 = 0.6033`
- `wins = 27 / 54`
- `winRate = 50.0%`

Delta:

- `avgF1 +0.1641` in favor of `MCMC`
- `wins +20 / 54`
- `winRate +37.0pp`

이 실험은 `all boards × 1 seed × 100 samples`에서 보였던 positive signal이 우연이 아니었는지 확인하는 repeatability check였다.

이번 matched run에서 `MCMC`는 18개 보드 중 15개에서 평균 F1이 더 높았고, 특히 다음 보드에서 차이가 컸다.

- `B17`: `SMC 0 / 3, 0.407` vs `MCMC 3 / 3, 0.788`
- `B09`: `SMC 0 / 3, 0.457` vs `MCMC 3 / 3, 0.809`
- `B11`: `SMC 0 / 3, 0.395` vs `MCMC 2 / 3, 0.744`
- `B18`: `SMC 1 / 3, 0.481` vs `MCMC 3 / 3, 0.762`
- `B03`: `SMC 0 / 3, 0.407` vs `MCMC 2 / 3, 0.682`

`MCMC` run 자체에서 특히 강했던 보드는 다음과 같다.

- `B09`: `3 / 3 wins`, `avgF1 = 0.809`
- `B17`: `3 / 3 wins`, `avgF1 = 0.788`
- `B18`: `3 / 3 wins`, `avgF1 = 0.762`
- `B04`: `3 / 3 wins`, `avgF1 = 0.732`
- `B15`: `3 / 3 wins`, `avgF1 = 0.706`

반대로 다음 보드들은 여전히 취약했다.

- `B01`: `0 / 3 wins`, `avgF1 = 0.383`
- `B12`: `0 / 3 wins`, `avgF1 = 0.395`
- `B13`: `0 / 3 wins`, `avgF1 = 0.420`
- `B16`: `0 / 3 wins`, `avgF1 = 0.481`

즉 현재 `M + MCMC`는 matched baseline 대비 명확히 우세하지만, 보드 유형별 편차는 아직 크다.

### 4. MCMC 500 vs 1000 Samples

기본 backend를 `mcmc`로 올린 뒤, 같은 설정에서 sample count를 `500`에서 `1000`으로 늘려 다시 검증했다.

설정:

- boards: `all`
- seeds: `3`
- belief: `mcmc`
- samples: `500` vs `1000`

`500`:

- run summary: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173156__m-mcmc__m-mcmc-all3-p500/summary.json)
- `avgF1 = 0.6033`
- `wins = 27 / 54`
- `winRate = 50.0%`

`1000`:

- run summary: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-174346__m-mcmc__m-default-all3-p1000/summary.json)
- run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-174346__m-mcmc__m-default-all3-p1000/run.json)
- per-game logs: [games.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-174346__m-mcmc__m-default-all3-p1000/games.jsonl)
- `avgF1 = 0.6190`
- `wins = 32 / 54`
- `winRate = 59.3%`

Delta:

- `avgF1 +0.0157`
- `wins +5 / 54`
- `winRate +9.3pp`

이 증가는 분명 있지만, 전면적 개선은 아니다. 보드별로는 trade-off가 있었다.

개선이 컸던 보드:

- `B01`: `0 / 3, 0.383` -> `2 / 3, 0.640`
- `B12`: `0 / 3, 0.395` -> `2 / 3, 0.631`
- `B13`: `0 / 3, 0.420` -> `2 / 3, 0.666`
- `B08`: `1 / 3, 0.554` -> `3 / 3, 0.718`
- `B15`: `3 / 3, 0.706` -> `3 / 3, 0.877`

반대로 내려간 보드도 있었다.

- `B03`: `2 / 3, 0.682` -> `1 / 3, 0.460`
- `B04`: `3 / 3, 0.732` -> `1 / 3, 0.563`
- `B09`: `3 / 3, 0.809` -> `1 / 3, 0.591`
- `B18`: `3 / 3, 0.762` -> `2 / 3, 0.537`

즉 `1000` samples는 평균적으로는 더 좋았지만, 특정 보드에서는 posterior가 덜 유리하게 작동했다.

### 5. Runtime

`run.json`의 `startedAt`과 `summary.json`의 `finishedAt` 기준:

- SMC all-boards run: 약 `26.3s`
- MCMC all-boards run: 약 `28.0s`
- SMC all-boards x 3 seeds x 500 samples: 약 `112.2s`
- MCMC all-boards x 3 seeds x 500 samples: 약 `155.5s`
- MCMC all-boards x 3 seeds x 1000 samples: 약 `249.4s`

근거:

- SMC run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172739__m-smc__m-smc-all1-p100/run.json)
- MCMC run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-172739__m-mcmc__m-mcmc-all1-p100/run.json)
- SMC all-boards x 3 seeds run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173853__m-smc__m-smc-all3-p500/run.json)
- MCMC all-boards x 3 seeds run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-173156__m-mcmc__m-mcmc-all3-p500/run.json)
- MCMC all-boards x 3 seeds x 1000 samples run meta: [run.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-174346__m-mcmc__m-default-all3-p1000/run.json)

현재 `1000` samples에서는 `MCMC`가 확실히 더 느리지만, 아직 실험 가능한 범위다.

---

## Interpretation

현재 관측은 다음처럼 읽는 게 맞다.

1. `M` 정책은 belief backend 영향을 크게 받는다.
2. 단일 보드 smoke는 noisy하다.
3. 다보드 평균에서는 `MCMC`가 더 좋은 posterior quality를 주는 신호가 있다.
4. matched baseline인 `all boards × 3 seeds × 500 samples`에서도 `MCMC`가 `SMC`를 큰 폭으로 앞섰다.
5. `MCMC` 내부에서도 `500 -> 1000` 증가는 평균 성능을 더 올렸다.
6. runtime overhead는 분명 존재한다.
   - `SMC`: 약 `112.2s`
   - `MCMC`: 약 `155.5s`
   - `MCMC 1000`: 약 `249.4s`
7. 그럼에도 성능 이득이 커서, 현재 tradeoff는 충분히 받아들일 만하다.
8. 다만 보드별 편차가 커서, 정책 취약점과 proposal mixing 문제가 같이 남아 있다.

즉 지금 시점의 working conclusion은:

**`M` 전략 기준으로는, 현 구현의 `MCMC` backend가 matched `SMC` baseline보다 명확히 우세하고, 현재 best observed setting은 `MCMC + 1000 samples`다.**

다만 아직 이걸 최종 결론으로 고정하면 안 된다.

- 특정 보드군에서는 `MCMC`가 반복적으로 막힌다.
- 현재 proposal은 one-ship move 하나뿐이라 mixing 개선 여지가 크다.
- 따라서 현재 결론은 “실험상 우세함이 확인됨”이지 “구조적으로 최적화가 끝남”은 아니다.

---

## Next Steps

우선순위는 다음 순서가 적절하다.

1. `100 / 200 / 500 / 1000` sample count sweep
2. `MMP`에도 같은 backend switch를 걸고 성능 차이 확인
3. `MCMC` proposal 개선 여부 확인
   - 현재는 one-ship move proposal만 사용
4. runtime/logging에 `belief ESS` 또는 sample diversity 지표 추가
