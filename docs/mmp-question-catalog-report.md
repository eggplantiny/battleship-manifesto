# MMP Question Catalog Report

**Date:** 2026-04-07  
**Scope:** `MMP` question catalog expansion, `questionId` tracing, and gate validation  
**Status:** Implemented and smoke-tested  
**Latest validated run:** `results/runs/20260407-171248__mmp__question-catalog-smoke-v2`

---

## 1. Executive Summary

이번 단계에서는 `MMP`의 질문 후보를 단순 template text 모음에서 **region-oriented question catalog**로 확장하고, 질문을 `questionId` 기반으로 추적되게 바꿨다.

핵심 구조 변화는 세 가지다.

1. 질문을 `id + family + text + evaluate`를 가진 descriptor로 승격
2. `askQuestion(questionId, questionText)` 형태로 MEL 실행 경로와 로그를 통일
3. `bestSimBoardValue`가 잘못 0으로 고정되던 MEL shadowing bug 수정

구조적으로는 성공했다.

- `questionId`가 strategy, runtime, effect, logger를 관통한다
- 질문 선택과 실행이 로그에서 일관되게 추적된다
- `block-2x2`, `row`, `column`, `quadrant` 등 더 넓은 질문 풀을 실제로 사용한다
- `fallbackTurns = 0`

하지만 성능은 아직 아니다.

- 최신 smoke run 결과: `LOST`, `F1 = 0.407`, `questions = 6`, `llmTurns = 9`
- 질문은 실행되지만, 정책 품질이 아직 안정적이지 않다
- 특히 `2x2 block` 질문이 자주 최상위로 올라오며, LLM adjudication 턴도 다시 늘어났다

즉 이번 단계의 결론은 다음이다.

- **구조:** 성공
- **관측 가능성:** 성공
- **정책 품질:** 미완성

---

## 2. Motivation

이전 구조에는 두 가지 문제가 있었다.

1. 질문이 `text` 중심이라 실행/로그/추적 경로가 느슨했다
2. 질문 풀이 작고 편향되어 있어, `질문도 action처럼 평가한다`는 방향을 충분히 실험하기 어려웠다

이번 단계의 목표는:

- 질문을 더 넓은 action-like catalog로 확장
- `questionId`를 first-class로 도입
- `M`과 `MMP`가 질문을 동일한 평가 인터페이스로 다루게 유지
- 실험 로그에서 “무슨 질문을 왜 골랐는지”를 stable identifier로 남기기

---

## 3. Implementation

### 3.1 Region-Oriented Question Catalog

[src/agent/template-questions.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/template-questions.ts#L1) 에 질문 catalog를 재구성했다.

질문은 이제 다음 구조를 가진다.

```ts
interface QuestionDescriptor {
  id: string
  family: QuestionFamily
  text: string
  evaluate: (board: Board) => boolean
}
```

추가된 family:

- `row`
- `column`
- `quadrant`
- `row-band-2`
- `column-band-2`
- `block-2x2`
- `freeform`

특히 `block-2x2`는 7×7 sliding window 전체를 생성하므로, 이전보다 훨씬 세밀한 region 질문이 가능해졌다.

### 3.2 Family-Diverse Sampling

질문 수가 크게 늘면서 `block-2x2`가 다른 family를 압도하지 않도록, selection은 family bucket 기반 round-robin sampling으로 바꿨다.

구현 위치:

- [src/agent/template-questions.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/template-questions.ts#L165)

의도는 단순하다.

- 질문 catalog는 넓게 유지
- 하지만 candidate sampling은 한 family에 쏠리지 않게 제어

### 3.3 questionId End-to-End Wiring

질문은 이제 text만이 아니라 `questionId`로 실행된다.

변경 경로:

- 전략 인터페이스: [src/agent/strategies/strategy.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/strategies/strategy.ts#L22)
- simulation 평가: [src/agent/core/simulation.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/core/simulation.ts#L59)
- 실제 질문 실행: [src/agent/core/game-loop.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/core/game-loop.ts#L51)
- runner logging: [src/agent/runner.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/agent/runner.ts#L108)
- snapshot summary: [src/experiment/logging.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/experiment/logging.ts#L9)

이제 로그에는 다음이 모두 남는다.

- `bestQuestionId`
- `decision.questionId`
- `question_result.data.id`
- `llmDecisionQuestionId`

### 3.4 MEL Update

MEL 도메인도 `questionId`를 first-class로 반영했다.

- base domain: [src/domain/battleship.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship.mel#L62)
- planning domain: [src/domain/battleship-mp.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-mp.mel#L100)

주요 변경:

- `askQuestion(questionId, questionText)`
- `lastQuestionId = questionId`
- `recordQuestionCandidate(questionId, questionText, questionValue)`
- `requestLLMDecision(..., bestQuestionId, bestQuestionText)`

이로써 질문의 identity가 text가 아니라 snapshot state에 명시적으로 남는다.

### 3.5 LLM Effect Update

LLM effect도 `bestQuestionId`를 payload로 받고, 응답 시 `llmDecisionQuestionId`를 snapshot에 쓴다.

구현 위치:

- [src/domain/effects.ts](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/effects.ts#L31)

이제 LLM이 `question`을 고른 경우에도, 로그는 단순 text가 아니라 동일한 stable id를 유지한다.

### 3.6 MEL Shadowing Bug Fix

검증 중 중요한 버그를 발견했다.

기존 `battleship-mp.mel`의 `recordSimResult(cell, hitProb, boardValue)`는 action parameter `boardValue`와 computed `boardValue` 이름이 충돌했다.

그 결과 gate가 비교해야 할 `bestSimBoardValue`가 실제 simulation value가 아니라, snapshot progress 기반 값으로 처리되거나 0으로 남는 상황이 생겼다.

수정:

- `boardValue` → `simBoardValue`

수정 위치:

- [src/domain/battleship-mp.mel](/home/eggp/dev/workspaces/experiments/battleship-manifesto/src/domain/battleship-mp.mel#L148)

이 버그는 정책 해석에 직접적인 영향을 줬기 때문에 중요하다.

---

## 4. Validation

기본 런타임 smoke:

- `scripts/test-mel.ts`
- `scripts/test-sim-session.ts`

둘 다 직접 실행해 통과를 확인했다.

실행 확인 포인트:

- `lastQuestionId`가 지정한 id로 기록되는가
- `sim.next(askQuestion, questionId, questionText)` 체인이 동작하는가
- 원본 runtime state가 시뮬레이션 이후에도 유지되는가

---

## 5. Experiment Setup

### 5.1 Diagnostic Run Before Bug Fix

명령:

```bash
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy mmp --boards B01 --seeds 1 --particles 1000 --model gemma3:4b-it-qat --label question-catalog-smoke
```

run dir:

- [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171128__mmp__question-catalog-smoke/summary.json)

이 run은 question catalog와 `questionId` wiring이 실제로 동작하는지 보는 구조 smoke였다.  
하지만 이후 확인된 MEL shadowing bug의 영향을 받기 때문에, 정책 품질 평가의 공식 결과로 쓰기는 어렵다.

### 5.2 Validated Run After Bug Fix

명령:

```bash
node --experimental-strip-types --experimental-transform-types --loader ./scripts/lib/resolve-ts-loader.mjs scripts/run-v2.ts --strategy mmp --boards B01 --seeds 1 --particles 1000 --model gemma3:4b-it-qat --label question-catalog-smoke-v2
```

run dir:

- [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/summary.json)

이 run을 이번 단계의 최신 validated smoke result로 본다.

---

## 6. Results

### 6.1 Pre-Fix Diagnostic Run

결과:

- `F1 = 0.40740740740740744`
- `questions = 15`
- `llmTurns = 0`
- `fallbackTurns = 0`

질문은 실제로 풍부하게 실행됐고, `questionId`도 올바르게 로그에 남았다.

예시:

- `block-2x2:D5-E6`
- `column-band-2:4-5`
- `row:F`
- `quadrant:bottom-left`

하지만 이 run에서는 `bestSimBoardValue`가 잘못 유지되어 질문 우위가 과대평가됐다.  
따라서 이 결과는 **질문 catalog wiring의 성공**만 보여주고, **정책 품질의 성공**을 의미하지는 않는다.

### 6.2 Post-Fix Validated Run

최신 smoke run 결과:

- Games: `1`
- Avg F1: `0.40740740740740744`
- Win Rate: `0`
- Shots: `40`
- Hits: `11`
- Questions: `6`
- LLM turns: `9`
- Auto-decided turns: `37`
- Fallback turns: `0`

근거:

- [summary.json](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/summary.json)

### 6.3 Question Usage

질문은 실제로 실행됐다.

대표 예시:

- turn 1: `block-2x2:D5-E6`
- turn 7: `column:1`
- turn 8: `column:7`
- turn 10: `block-2x2:G6-H7`
- turn 20: `block-2x2:E7-F8`
- turn 21: `block-2x2:A5-B6`

근거:

- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L9)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L55)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L62)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L76)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L160)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L167)

### 6.4 Gate Behavior

bug fix 이후 gate는 더 이상 `bestSimBoardValue = 0`을 기준으로 움직이지 않았다.

예를 들어:

- turn 1: `bestSimBoardValue = 0.0231`, `bestQuestionValue = 0.0356`, `questionEdge = 0.0124`
- turn 2: `bestSimBoardValue = 0.0386`, `bestQuestionValue = 0.0429`, `questionEdge = 0.0043`
- turn 3: `bestSimHitProb = 0.80` 이라 자동 `shoot`
- turn 11 이후: 다수 turn이 `llmAdjudicationNeeded = true`

즉 gate는 이제 실제로 다음 세 갈래를 모두 사용한다.

- auto question
- auto shoot
- LLM adjudication

이 점은 구조적으로 매우 중요하다.

### 6.5 LLM Usage

최신 validated run에서는 `llmTurns = 9`였다.

대표 ambiguous turn:

- turn 2: `questionEdge = 0.0043`
- turn 4: `questionEdge = 0.0028`
- turn 11: `questionEdge = 0.0071`
- turn 12: `questionEdge = 0.0102`
- turn 13: `questionEdge = 0.0014`

근거:

- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L14)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L30)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L81)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L90)
- [events.jsonl](/home/eggp/dev/workspaces/experiments/battleship-manifesto/results/runs/20260407-171248__mmp__question-catalog-smoke-v2/events.jsonl#L99)

중요한 점은 `fallbackTurns = 0`이라는 것이다.  
즉 구조는 안정적으로 동작한다.

---

## 7. Interpretation

### 7.1 What Worked

이번 단계에서 성공한 것은 명확하다.

1. 질문이 action-like descriptor로 정리됐다
2. `questionId`가 end-to-end로 유지된다
3. 질문 풀 확장이 실제 선택으로 이어졌다
4. gate가 이제 실제 simulation value를 기준으로 작동한다
5. `auto` / `llm` / `fallback` 분기가 모두 관측 가능해졌다

즉 **실험 구조와 추적 가능성은 훨씬 좋아졌다.**

### 7.2 What Did Not Improve Yet

최신 validated smoke 기준으로 성능 개선은 확인되지 않았다.

- `F1 = 0.407`
- `LOST`
- `llmTurns = 9`

구조는 나아졌지만, 정책은 아직 아니다.

가장 유력한 원인은 다음 둘이다.

1. `block-2x2` 질문이 기대값상 자주 이기며, 질문 풀이 여전히 지나치게 local할 수 있다
2. `questionEdge`가 작은 구간에서 LLM adjudication이 자주 발생해 latency 비용이 커진다

### 7.3 Reinterpretation of Earlier Results

이전 `explore-check` 같은 높은 수치의 run은, 이번에 수정한 MEL shadowing bug 이전 결과다.  
따라서 그 수치는 **구조 smoke**로는 의미가 있지만, 현재 정책의 공식 baseline으로 그대로 쓰기는 어렵다.

정확히 말하면:

- 이전 결과가 무가치한 것은 아님
- 하지만 현재 gate가 의도대로 작동한 환경의 수치와는 직접 비교하면 안 된다

---

## 8. Conclusion

이번 단계의 결론은 간단하다.

- 질문 catalog 확장과 `questionId` 도입은 성공
- MEL/strategy/effect/logger의 identity seam 정리는 성공
- runtime 안정성도 확보됨 (`fallback = 0`)
- 하지만 정책 성능은 아직 개선되지 않음

즉 지금 상태의 `MMP`는 **“구조는 맞고, 정책은 아직 다듬어야 하는 버전”**이다.

---

## 9. Next Steps

우선순위는 다음 순서가 적절하다.

1. **Question family ablation**
   - `block-2x2`를 잠시 끄고 `row/column/quadrant`만으로 비교
2. **Family quota tuning**
   - sampling 단계에서 `block-2x2` 비중을 더 강하게 제한
3. **Question gating sweep**
   - `questionEdge` 기준을 조정해 `LLM adjudication` 턴 수를 줄이기
4. **All-board evaluation**
   - 위 정책 조정 후 `all boards × multiple seeds`
5. **Report hygiene**
   - pre-fix run은 “diagnostic only”, post-fix run을 official smoke baseline으로 명시
