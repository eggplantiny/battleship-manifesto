# MMP Conditional LLM Effect Report

**Date:** 2026-04-07  
**Scope:** `MMP` strategy only  
**Status:** Implemented and smoke-tested  
**Official run:** `results/runs/20260407-164910__mmp__conditional-llm-effect-v3`

---

## 1. Summary

`MMP`를 기존의 `M computes, LLM always decides` 구조에서 `M computes, policy gates, LLM effect resolves only ambiguous turns` 구조로 변경했다.

핵심 변화는 두 가지다.

1. **LLM 호출 여부를 전략이 먼저 결정한다.**
2. **실제 LLM 호출은 Manifesto effect로 내려서 snapshot state로만 결과를 되돌린다.**

이 변경으로 실험 1판에서 전체 40턴 중 **2턴만 LLM을 호출**했고, 나머지 **38턴은 자동 결정**됐다.

---

## 2. Motivation

이전 `MMP`는 매 턴 다음 순서를 탔다.

1. 모든 셀 brute-force 평가
2. top-5 후보 계산
3. 최고 질문 계산
4. 곧바로 `llm.chat(...)`
5. LLM 응답을 파싱해 최종 액션 결정

문제는 두 가지였다.

- **비용**: LLM이 매 턴 병목이었다.
- **구조 위반**: `MMPStrategy`가 직접 IO를 수행해서, LLM이 runtime seam 바깥의 특수 경로로 존재했다.

이번 변경의 목표는 아래와 같았다.

- 애매한 턴에서만 LLM 사용
- LLM을 runtime effect로 격하
- 요청/응답/오류/latency를 snapshot과 로그에 남기기
- fallback을 결정론적으로 유지하기

---

## 3. Implementation

### 3.1 Policy Gate

`MMP` 게이트는 [src/agent/strategies/mmp-strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/strategies/mmp-strategy.ts#L25) 에 구현했다.

현재 기준 상수는 다음과 같다.

- `AUTO_SHOOT_HIT_PROB = 0.5`
- `MIN_QUESTION_EDGE_FOR_LLM = 0.015`
- `AUTO_QUESTION_MARGIN = 0.03`

결정 규칙은 다음과 같다.

- 질문 후보가 없으면 자동 `shoot`
- `bestShoot.hitProb >= 0.5` 이면 자동 `shoot`
- `bestQuestion.value - bestShoot.boardValue >= 0.03` 이면 자동 `question`
- `bestQuestion.value - bestShoot.boardValue <= 0.015` 이면 자동 `shoot`
- 그 사이의 애매한 구간만 `LLM effect` 요청

즉, LLM은 정책 엔진이 아니라 **애매한 tradeoff를 풀기 위한 조건부 adjudicator**다.

### 3.2 Manifesto Effect Seam

MEL 쪽에는 LLM 관련 상태와 effect action을 추가했다.

- state fields: [src/domain/battleship-mp.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-mp.mel#L25)
- `requestLLMDecision(...)`: [src/domain/battleship-mp.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-mp.mel#L134)

추가된 snapshot state:

- `llmStatus`
- `llmRawResponse`
- `llmErrorMessage`
- `llmLatencyMs`
- `llmDecisionAction`
- `llmDecisionCellId`
- `llmDecisionQuestionText`

이제 strategy는 더 이상 직접 `fetch`나 `llm.chat()`를 하지 않는다.  
전략은 `requestLLMDecision(...)`를 dispatch하고, 결과는 snapshot에서 읽는다.

### 3.3 Host Effect Handler

Ollama 호출은 [src/domain/effects.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/effects.ts#L30) 로 이동했다.

handler 책임:

- `systemPrompt`, `userPrompt`, `candidateCellsCsv`, `bestQuestionText` 수신
- `gemma3:4b-it-qat` 호출
- 응답을 `shoot` / `question` 형태로 파싱
- patch 배열로 `llmStatus`, `llmDecision*`, `llmLatencyMs` 갱신
- 실패 시 throw 대신 error state patch 반환

즉 effect handler는 **IO adapter**이고, 정책 자체는 전략에 남아 있다.

### 3.4 Runtime Wiring

Lineage runtime이 effect handler를 실제로 받도록 [src/domain/wire.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/wire.ts#L21) 를 수정했다.

`run-v2`도 `MMPStrategy(model)`과 runtime effect options를 함께 넘기도록 바꿨다.

- strategy/model binding: [scripts/run-v2.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/scripts/run-v2.ts#L31)
- lineage runtime effect injection: [scripts/run-v2.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/scripts/run-v2.ts#L84)

### 3.5 Logging / Summary

로그 스키마와 summary도 확장했다.

- snapshot 요약 필드 확장: [src/experiment/logging.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/experiment/logging.ts#L9)
- run summary 집계: [scripts/lib/file-experiment-logger.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/scripts/lib/file-experiment-logger.ts#L46)

추가된 핵심 event:

- `gate_decision`
- `llm_effect_requested`
- `llm_effect_resolved`
- `fallback`
- `final_decision`

추가된 run summary:

- `llmTurns`
- `autoDecidedTurns`
- `fallbackTurns`

---

## 4. Experiment Setup

실행 명령:

```bash
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy mmp --boards B01 --seeds 1 --particles 1000 --model gemma3:4b-it-qat --label conditional-llm-effect-v3
```

설정:

- Strategy: `mmp`
- Board: `B01`
- Seeds: `1`
- Particles: `1000`
- Model: `gemma3:4b-it-qat`
- Run dir: `results/runs/20260407-164910__mmp__conditional-llm-effect-v3`

공식 결과 요약은 [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/summary.json) 에 남아 있다.

---

## 5. Results

### 5.1 Aggregate

- Games: `1`
- Avg F1: `0.4444444444444444`
- Win Rate: `0`
- Shots: `40`
- Hits: `12`
- Questions asked: `0`
- LLM turns: `2`
- Auto-decided turns: `38`
- Fallback turns: `0`

### 5.2 LLM Usage

전체 40턴 중 LLM이 실제로 호출된 턴은 2개뿐이었다.

- turn 4: `valueGap = 0.015496...`, `hitProb = 0.422...`, LLM 응답 `shoot D7`, latency `13716ms`
- turn 5: `valueGap = 0.017285...`, `hitProb = 0.465...`, LLM 응답 `shoot E2`, latency `6212ms`

근거:

- ambiguous turn 4: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L27)
- ambiguous turn 5: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L36)
- effect resolution turn 4: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L29)
- effect resolution turn 5: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L38)

### 5.3 Auto Decisions

초반 turn 1~3은 모두 `shoot_preferred`로 자동 사격됐다.

- turn 1: `valueGap = 0.009999...`
- turn 2: `valueGap = 0.011411...`
- turn 3: `valueGap = 0.011714...`

즉 질문 가치가 shoot를 약간 앞섰지만, LLM을 부를 정도로 크지 않다고 판단했다.

근거:

- turn 1: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L6)
- turn 2: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L13)
- turn 3: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L20)

후반에는 `bestShoot.hitProb = 1.0` 인 구간이 반복적으로 나와 `high_hit_probability`로 자동 사격됐다.

- turn 38: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L269)
- turn 39: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L276)
- turn 40: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-164910__mmp__conditional-llm-effect-v3/events.jsonl#L283)

### 5.4 Fallback

이번 공식 run에서는 fallback이 한 번도 발생하지 않았다.

- `fallbackTurns = 0`
- effect failure 없음
- parse failure 없음

---

## 6. Interpretation

이번 변경은 목적을 달성했다.

1. **LLM이 runtime effect로 격하됐다.**
2. **정책과 IO가 분리됐다.**
3. **LLM 사용량이 40턴 중 2턴으로 감소했다.**
4. **모든 decision trace가 snapshot/log에 남는다.**

반면, 성능 측면에서는 아직 개선을 보여주지 못했다.

- 결과 F1은 `0.444`
- 질문이 실제로 한 번도 실행되지 않았다
- ambiguous turn에서도 Gemma는 모두 `shoot`를 선택했다

즉 현재 구조는 `LLM 비용 절감`과 `Manifesto seam 정리`에는 성공했지만, `explore를 실제로 유도하는 정책`까지는 아직 아니다.

---

## 7. Limitations

### 7.1 Question 실행 부재

이번 run에서 `bestQuestion`은 계속 계산됐지만 최종 실행된 질문은 없었다.  
현재 게이트와 Gemma 조합은 여전히 exploit 쪽으로 강하게 기운다.

### 7.2 Threshold Calibration

현재 threshold는 hand-tuned 값이다.

- `AUTO_SHOOT_HIT_PROB = 0.5`
- `MIN_QUESTION_EDGE_FOR_LLM = 0.015`
- `AUTO_QUESTION_MARGIN = 0.03`

이 값들은 B01 한 판 기준으로 조정한 것이므로, 다보드/다시드 실험이 필요하다.

### 7.3 Model Dependence

LLM 응답은 여전히 `Gemma`의 편향을 따른다.  
이번 run에서 Gemma는 애매한 두 턴 모두 질문보다 사격을 택했다.

---

## 8. Next Steps

우선순위는 다음 순서가 적절하다.

1. **다보드 실험**
   - `B01` 한 판이 아니라 `all boards × multiple seeds`로 `llmTurns`, `question usage`, `F1` 분포를 확인
2. **Question-favoring gate ablation**
   - `MIN_QUESTION_EDGE_FOR_LLM`과 `AUTO_QUESTION_MARGIN`을 sweep
3. **Forced-question comparison**
   - 애매한 구간에서 LLM에게 선택권을 주지 않고 자동 `question`을 실행하는 variant와 비교
4. **Model ablation**
   - `gemma3` 외 `gemma4`, `qwen3.5` 비교
5. **Question rationale logging**
   - 필요하면 effect 응답 포맷을 `JSON { action, rationale }`로 바꿔 짧은 설명까지 저장

---

## 9. Conclusion

이번 작업으로 `MMP`의 LLM은 더 이상 매 턴 직접 호출되는 특수 경로가 아니다.  
이제 `M`이 먼저 계산하고, 전략이 게이트를 결정하며, 정말 애매한 턴에서만 `Manifesto effect`로 LLM을 호출한다.

구조적으로는 올바른 방향이고, 실험적으로도 **40턴 중 2턴만 LLM 사용**이라는 분명한 절감 효과가 확인됐다.  
다음 과제는 이 절감 구조 위에서 실제 `question` 사용을 늘려, Bayesian explore 성능을 다시 끌어올리는 것이다.

---

## Addendum: MEL-Driven Explore Bias

위 본문은 초기 conditional-LLM 버전 기준이다. 이후 `explore가 전혀 실행되지 않는다`는 문제를 해결하기 위해, 질문 유도 게이트를 MEL computed로 올렸다.

추가된 핵심 computed:

- `earlyGame`
- `questionBudgetRich`
- `shouldExplore`
- `questionEdge`
- `autoQuestionPreferred`
- `autoShootPreferred`
- `llmAdjudicationNeeded`

구현 위치:

- MEL computed / state / action: [src/domain/battleship-mp.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-mp.mel#L25)
- strategy read path: [src/agent/strategies/mmp-strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/strategies/mmp-strategy.ts#L95)

정책은 다음과 같이 바뀌었다.

- 초반(`turnNumber < 10`)이고 질문 예산이 넉넉할 때(`questionsRemaining > 10`)
- 질문 가치가 shoot보다 조금이라도 앞서면(`questionEdge > 0.005`)
- 자동 `question`

이후 확인 run:

- run dir: [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-165612__mmp__explore-check/summary.json)
- result: `WON`
- F1: `0.5490196078431372`
- shots: `37`
- hits: `14`
- questions: `15`
- llmTurns: `0`
- fallbackTurns: `0`

중요한 점은 이번 run의 목적이 `LLM 사용`이 아니라 `explore가 실제로 실행되는가` 검증이었다는 것이다. 그 기준에서는 명확히 성공했다.

근거:

- `early_explore_bias` turn 1: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-165612__mmp__explore-check/events.jsonl#L6)
- `early_explore_bias` turn 2: [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-165612__mmp__explore-check/events.jsonl#L13)
- total question executions: `15`

즉 현재 구조는 두 단계를 모두 확보했다.

1. LLM은 effect로 격하되어 runtime seam 안에 있다.
2. explore 정책은 MEL-computed reason으로 설명 가능하다.

이제 다음 실험은 이 MEL-driven explore bias 버전을 기준으로 `all boards × multiple seeds` 평가를 돌려 보는 것이다.
