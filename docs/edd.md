# EDD: Collaborative Battleship on Manifesto

**Version:** 2.0  
**Author:** 정성우  
**Date:** 2026-04-07  
**Status:** Draft  
**Reference:** Grand et al. (2025) "Shoot First, Ask Questions Later" (ICLR 2026, arXiv:2510.20886)  
**Goal:** Gabe의 Collaborative Battleship을 Manifesto로 재현하고, 동일 조건에서 성능 비교

---

## 1. One-Line Summary

MEL 도메인 + `computeSync` + LLM snapshot reading으로, LIPS 없이 Bayesian Captain 에이전트를 만들어 Gabe의 결과와 동일 조건에서 비교한다.

---

## 2. 왜 이걸 하는가

Manifesto의 구조적 우월성 세 가지를 **숫자로 증명**한다:

1. **Simulation substrate**: `computeSync`로 Monte Carlo hit probability 계산 — Gabe의 Python 시뮬레이터 대체
2. **Agent-readable world model**: LLM이 snapshot + MEL + 인과그래프를 읽고 질문을 생성하고 판단 — LIPS 시스템 대체
3. **Causal traceability**: `getSchemaGraph()` + `explain()` — Gabe에게 없는 것

부차적 목표: Gabe Grand에게 결과를 보여주고 협업 가능성 타진

---

## 3. Gabe 논문의 구조 (정확한 스펙)

### 3.1 게임 규칙

- **8×8 보드**, 배 여러 개 (18개 pre-sampled 보드)
- **Captain**: 보드 안 보임. 매 턴 "질문(explore)" 또는 "사격(exploit)" 선택
- **Spotter**: 보드 보임. yes/no만 대답. **Noisy channel** — BSC(ε), ε=0.1
- 자원 제한: **shots 40회, questions 15회** (총 55턴)

### 3.2 두 벤치마크

| Benchmark | 역할 | 평가 대상 |
|-----------|------|----------|
| **SpotterQA** | Spotter 성능 평가 | LM이 보드를 보고 질문에 yes/no 대답하는 정확도 |
| **CaptainQA** | Captain 전체 게임 평가 | 질문+사격 전략의 종합 성능 |

이 프로젝트는 **CaptainQA**에 집중한다. Spotter는 oracle (ε=0)로 시작하고, 추후 GPT-5 CoT+Code Spotter (ε=0.1)로 확장.

### 3.3 Gabe의 시스템 구성

| Component | 역할 |
|-----------|------|
| Python Simulator | 게임 규칙 + 상태 전이 |
| Board Sampler | SMC (Sequential Monte Carlo) particle set 관리 |
| LIPS | 자연어 질문 → Python 프로그램 `f_q: S → {0,1}` 변환 |
| EIG Calculator | 닫힌 형태 binary entropy (Eq.4) |
| Captain Strategy | Q_Bayes, M_Bayes, D_Bayes 조합 |

### 3.4 세 가지 Bayesian 전략 (Table 1)

| 전략 | 역할 | 수식 |
|------|------|------|
| **Q_Bayes** | 후보 질문 중 EIG 최대 선택 | `q* = argmax_q EIG_ε(q)` |
| **M_Bayes** | hit probability 최대 셀 사격 | `u* = argmax_u p_hit(u)` |
| **D_Bayes** | explore vs exploit 결정 | `γ · p_hit_post_question > p_hit_current` → 질문, 아니면 사격 |

### 3.5 EIG 계산 — 닫힌 형태 (Eq.4)

```
EIG_ε(q) = H_b(ε + (1 - 2ε) · p_t) - H_b(ε)

여기서:
  p_t = Σ π_t(s) · 𝟙{f_q(s) = 1}   (가설 보드 중 "yes"인 비율)
  H_b(x) = -x·log₂(x) - (1-x)·log₂(1-x)   (binary entropy)
  ε = noise rate (우리는 0으로 시작, oracle Spotter)
```

ε=0이면: `EIG(q) = H_b(p_t)`. p_t가 0.5에 가까울수록 EIG 최대 (= 가장 반반으로 갈리는 질문).

### 3.6 SMC (Sequential Monte Carlo) Particle Set

매 턴 처음부터 rejection sampling하지 않음. Weighted particle set을 유지:

```
1. 초기: N개 uniform random 보드 생성, 각 가중치 w = 1/N
2. 관측(hit/miss) 발생 시: 불일치 보드의 가중치 → 0, 정규화
3. 답변(yes/no) 수신 시: Eq.2로 가중치 업데이트 (ε 반영)
4. 가중치 퇴화 시: 리샘플링 (effective sample size 기준)
```

### 3.7 Gabe의 결과 (논문 Fig.4a, Table에서 추출)

| Captain Strategy | LM | Targeting F1 | Win Rate |
|-----------------|-----|-------------|----------|
| Random | — | ~0.20 | — |
| Greedy | — | ~0.30 | — |
| LM-only | Llama-4-Scout | 0.367 | — |
| LM-only | GPT-4o | 0.450 | — |
| LM-only | GPT-5 | 0.716 | — |
| +Bayes-QMD | Llama-4-Scout | 0.764 | 0.81–0.82 |
| +Bayes-QMD | GPT-4o | 0.782 | 0.82–0.83 |
| Human (N=42) | — | ~0.55 | — |

핵심 발견: **Bayesian 전략이 약한 LM도 초인간 수준으로 끌어올린다.**

### 3.8 데이터셋 (공개)

- `experiments/collaborative/contexts/board_BXX.txt` — 18개 보드 컨텍스트
- `data/human-dataset.csv` — 42명 인간, 126게임 full trajectory
- 코드: `gabegrand.github.io/battleship`, MIT 라이센스

---

## 4. Manifesto 구현 설계

### 4.1 아키텍처

```
battleship.mel
  ↓ compile
DomainSchema
  ↓ createManifesto(schema, effects).activate()
Runtime
  ├── getSnapshot()           ← LLM이 읽는 상태
  ├── getSchemaGraph()        ← 인과 그래프
  ├── explain()               ← 수학적 trace
  └── dispatchAsync(intent)   ← action 실행

Captain Agent (TypeScript)
  ├── SMC Particle Set: N개 가설 보드, 가중치 관리
  ├── M_Bayes: particle set에서 cell별 hit probability 계산
  ├── Q_Bayes: LLM이 질문 생성 + 평가 함수 출력 → EIG 계산
  ├── D_Bayes: explore vs exploit 결정
  └── Spotter Oracle: 정답 보드로 yes/no 응답
```

### 4.2 LIPS 대체: LLM이 snapshot을 읽고 질문 + 평가 함수를 생성

Gabe의 LIPS가 하는 것:

```
LLM → "Is there a ship in row 3?" → Python: lambda board: any(board[3][c] == "ship" for c in range(8))
```

Manifesto 대체:

```
LLM에게 제공:
  1. snapshot.data — 현재 게임 상태 (각 cell의 status, 남은 자원 등)
  2. snapshot.computed — hitRate, shipDensity, progress 등 파생 값
  3. getSchemaGraph() — state/computed 간 인과 의존성
  4. MEL 소스 — 도메인의 전체 구조

LLM 출력:
  {
    questionText: "Is there a ship in row 3?",
    evaluate: (board) => board.cells.filter(c => c.row === 3).some(c => c.hasShip)
  }
```

**왜 LIPS가 불필요한가:**

LIPS는 LLM이 게임 구조를 모르기 때문에 자연어→코드 변환 파이프라인이 필요했다.
Manifesto에서는 LLM이 **MEL 도메인 정의 + 인과그래프 + 현재 snapshot**을 직접 읽는다.
게임의 전체 구조와 현재 상태를 이해한 상태에서 질문과 그 평가 로직을 동시에 출력한다.
별도의 "언어→코드 변환 시스템"이 필요 없다 — LLM이 이미 구조를 안다.

### 4.3 EIG 계산

```ts
function computeEIG(
  question: { text: string; evaluate: (board: Board) => boolean },
  particles: WeightedBoard[],
  epsilon: number = 0  // oracle Spotter
): number {
  // p_t: 가설 보드 중 "yes"인 가중치 비율
  const p_t = particles.reduce((sum, { board, weight }) =>
    sum + (question.evaluate(board) ? weight : 0), 0);

  // 닫힌 형태 EIG (Eq.4)
  const H_b = (x: number) =>
    x <= 0 || x >= 1 ? 0 : -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);

  return H_b(epsilon + (1 - 2 * epsilon) * p_t) - H_b(epsilon);
}
```

ε=0 (oracle)이면 `EIG = H_b(p_t)`. 가장 반반으로 갈리는 질문이 최고.

### 4.4 Hit Probability 계산 (M_Bayes)

```ts
function computeHitProbabilities(
  particles: WeightedBoard[],
  revealedCells: Set<number>
): Map<number, number> {
  const probs = new Map<number, number>();

  for (let i = 0; i < 64; i++) {  // 8×8 = 64 cells
    if (revealedCells.has(i)) continue;
    const p_hit = particles.reduce((sum, { board, weight }) =>
      sum + (board.cells[i].hasShip ? weight : 0), 0);
    probs.set(i, p_hit);
  }

  return probs;
}
```

### 4.5 D_Bayes: Explore vs Exploit 결정

```ts
function decideTurn(
  bestQuestion: { text: string; evaluate: (board: Board) => boolean; eig: number },
  hitProbs: Map<number, number>,
  particles: WeightedBoard[],
  questionsRemaining: number,
  gamma: number = 0.95,
  epsilon: number = 0
): Intent {
  if (questionsRemaining <= 0) {
    // 질문 불가 → 사격
    const bestCell = argmax(hitProbs);
    return makeIntent('shoot', { cellIndex: bestCell });
  }

  // 현재 최고 hit probability
  const currentBestHitProb = max(hitProbs.values());

  // 질문 후 예상 hit probability (Eq.7)
  const p_t = particles.reduce((sum, { board, weight }) =>
    sum + (bestQuestion.evaluate(board) ? weight : 0), 0);

  // yes/no 각 경우의 posterior에서 best hit prob 계산
  const postQuestionHitProb = computePostQuestionHitProb(
    bestQuestion, particles, hitProbs, p_t, epsilon
  );

  // D_Bayes 결정: γ-discounted post-question > current → 질문
  if (gamma * postQuestionHitProb > currentBestHitProb) {
    return makeIntent('askQuestion', { questionText: bestQuestion.text });
  } else {
    const bestCell = argmax(hitProbs);
    return makeIntent('shoot', { cellIndex: bestCell });
  }
}
```

### 4.6 SMC Particle Set 관리

```ts
class ParticleSet {
  particles: { board: Board; weight: number }[];

  constructor(shipConfig: ShipConfig, count: number = 500) {
    this.particles = Array.from({ length: count }, () => ({
      board: randomPlaceShips(8, 8, shipConfig),
      weight: 1 / count,
    }));
  }

  // 사격 결과 관측 후 업데이트
  observeShot(cellIndex: number, isHit: boolean): void {
    for (const p of this.particles) {
      const cellHasShip = p.board.cells[cellIndex].hasShip;
      if (cellHasShip !== isHit) {
        p.weight = 0;  // 관측과 불일치 → 제거
      }
    }
    this.normalize();
    this.resampleIfNeeded();
  }

  // 질문 답변 수신 후 업데이트 (Eq.2)
  observeAnswer(
    evaluate: (board: Board) => boolean,
    answer: boolean,  // Spotter의 답변
    epsilon: number = 0
  ): void {
    for (const p of this.particles) {
      const trueAnswer = evaluate(p.board);
      if (trueAnswer === answer) {
        p.weight *= (1 - epsilon);
      } else {
        p.weight *= epsilon;
      }
    }
    this.normalize();
    this.resampleIfNeeded();
  }

  private normalize(): void { /* 가중치 합 = 1 */ }

  private resampleIfNeeded(): void {
    const ess = 1 / this.particles.reduce((s, p) => s + p.weight ** 2, 0);
    if (ess < this.particles.length / 2) {
      this.resample();  // systematic resampling
    }
  }
}
```

### 4.7 Captain 턴 전체 흐름

```ts
async function captainTurn(
  runtime: ManifestoRuntime,
  particleSet: ParticleSet,
  llm: LLM,
  trueBoard: Board  // Spotter oracle용
): Promise<void> {
  const snapshot = runtime.getSnapshot();
  const graph = runtime.getSchemaGraph();

  // 1. M_Bayes: hit probability 계산
  const hitProbs = computeHitProbabilities(
    particleSet.particles,
    getRevealedCells(snapshot)
  );

  // 2. Q_Bayes: LLM이 후보 질문 K개 생성
  const candidates = await llm.generateQuestions(snapshot, graph, K=10);

  // 3. 각 후보의 EIG 계산, 최고 선택
  const scored = candidates.map(q => ({
    ...q,
    eig: computeEIG(q, particleSet.particles),
  }));
  const bestQuestion = scored.sort((a, b) => b.eig - a.eig)[0];

  // 4. D_Bayes: explore vs exploit 결정
  const intent = decideTurn(bestQuestion, hitProbs, particleSet.particles,
    snapshot.data.questionsRemaining);

  // 5. 실행
  await runtime.dispatchAsync(intent);

  // 6. Spotter oracle 응답 (질문인 경우)
  if (intent.action === 'askQuestion') {
    const answer = bestQuestion.evaluate(trueBoard);
    await runtime.dispatchAsync(
      makeIntent('receiveAnswer', {
        questionId: snapshot.data.lastQuestionId,
        answer,
      })
    );
    particleSet.observeAnswer(bestQuestion.evaluate, answer);
  }

  // 7. 사격 결과로 particle set 업데이트 (사격인 경우)
  if (intent.action === 'shoot') {
    const result = runtime.getSnapshot().data.lastShotResult;
    particleSet.observeShot(intent.params.cellIndex, result === 'hit');
  }
}
```

---

## 5. battleship.mel 설계

```
domain Battleship {
  state {
    // 보드
    cells: Record<string, Cell> = {}        // 64개 (8×8)
    ships: Record<string, Ship> = {}
    totalShipCells: number = 0

    // 자원
    turnNumber: number = 0
    shotsRemaining: number = 40
    questionsRemaining: number = 15
    shotsFired: number = 0
    questionsAsked: number = 0

    // 게임 상태
    phase: string = "setup"                 // setup | playing | won | lost

    // 질문 로그
    questions: Record<string, Question> = {}
    lastQuestionId: string | null = null

    // 사격 결과
    lastShotResult: string | null = null    // hit | miss | null
    lastShotIndex: number | null = null
  }

  type Cell {
    index: number
    row: number
    col: number
    hasShip: boolean       // setup 시 설정, Captain에게는 숨김
    status: string         // unknown | hit | miss
    shipId: string | null
  }

  type Ship {
    id: string
    size: number
    cells: number[]        // cell indices
    sunk: boolean
  }

  type Question {
    id: string
    text: string
    answer: boolean | null
    turnAsked: number
  }

  computed unknownCount = len(effect array.filter({ source: values(cells), where: eq($item.status, "unknown") }))
  computed hitCount = len(effect array.filter({ source: values(cells), where: eq($item.status, "hit") }))
  computed missCount = len(effect array.filter({ source: values(cells), where: eq($item.status, "miss") }))
  computed shipCellsRemaining = sub(totalShipCells, hitCount)
  computed allShipsSunk = eq(shipCellsRemaining, 0)
  computed hitRate = cond(eq(shotsFired, 0), 0, div(hitCount, shotsFired))
  computed progress = div(hitCount, totalShipCells)
  computed targetingPrecision = cond(eq(shotsFired, 0), 0, div(hitCount, shotsFired))
  computed targetingRecall = div(hitCount, totalShipCells)
  computed targetingF1 = cond(
    eq(add(targetingPrecision, targetingRecall), 0),
    0,
    div(mul(2, mul(targetingPrecision, targetingRecall)), add(targetingPrecision, targetingRecall))
  )

  action setupBoard(boardCells: Record<string, Cell>, boardShips: Record<string, Ship>, shipCellCount: number) {
    onceIntent {
      patch cells = boardCells
      patch ships = boardShips
      patch totalShipCells = shipCellCount
      patch phase = "playing"
    }
  }

  action shoot(cellIndex: number) {
    available when and(eq(phase, "playing"), gt(shotsRemaining, 0))

    onceIntent {
      patch turnNumber = add(turnNumber, 1)
      patch shotsRemaining = sub(shotsRemaining, 1)
      patch shotsFired = add(shotsFired, 1)
      patch lastShotIndex = cellIndex

      // cell status 업데이트는 effect handler에서 처리
      // (hasShip 확인 → hit/miss 결정 → patch 반환)
      effect game.resolveShot({ cellIndex: cellIndex, into: lastShotResult })
    }
  }

  action askQuestion(questionText: string) {
    available when and(eq(phase, "playing"), gt(questionsRemaining, 0))

    onceIntent {
      patch turnNumber = add(turnNumber, 1)
      patch questionsRemaining = sub(questionsRemaining, 1)
      patch questionsAsked = add(questionsAsked, 1)
      patch lastQuestionId = $system.uuid
      patch questions[$system.uuid] = {
        id: $system.uuid,
        text: questionText,
        answer: null,
        turnAsked: turnNumber
      }
    }
  }

  action receiveAnswer(questionId: string, answer: boolean) {
    onceIntent {
      patch questions[questionId].answer = answer
    }
  }

  action endGame(result: string) {
    onceIntent {
      patch phase = result
    }
  }
}
```

**Note:** 위는 MEL 설계 초안이다. 컴파일러와 맞추면서 조정 필요. 특히 computed에서 `effect array.filter`는 금지 — computed는 순수해야 하므로 별도 접근이 필요하다.

---

## 6. LLM 질문 생성 프롬프트 설계

LLM에게 제공하는 컨텍스트:

```
You are the Captain in a Collaborative Battleship game.

## Domain Structure (MEL)
{battleship.mel 전체}

## Causal Graph
{getSchemaGraph() 출력 — 어떤 computed가 어떤 state에 의존하는지}

## Current Snapshot
{snapshot.data + snapshot.computed 전체}

## Your Task
Generate {K} diverse yes/no questions about the hidden board.
For each question, also provide a JavaScript evaluation function
that takes a board object and returns true (yes) or false (no).

The board object has: cells[] with { index, row, col, hasShip }.

Output format:
[
  {
    "text": "Is there a ship in row 3?",
    "evaluateCode": "(board) => board.cells.filter(c => c.row === 3).some(c => c.hasShip)"
  },
  ...
]

Guidelines:
- Ask questions that split the hypothesis space roughly in half (maximize information)
- Consider what you've already learned from the snapshot
- Leverage the causal graph to identify high-impact unknowns
- Avoid redundant questions (check questions[] in snapshot)
```

**LIPS와의 차이:**
- LIPS: 자연어 질문을 별도 시스템이 Python으로 변환 (~800줄)
- Manifesto: LLM이 MEL + 인과그래프 + snapshot을 읽고, 질문과 평가 함수를 **동시에** 출력. 변환 시스템 불필요.

---

## 7. Gabe와의 차별점 시연

### 7.1 인과 그래프 (Gabe에게 없는 것)

```ts
const graph = getSchemaGraph(schema);

graph.traceDown('targetingF1');
// → targetingPrecision → hitCount → cells[*].status
//                       → shotsFired → shoot action
// → targetingRecall → hitCount → cells[*].status
//                    → totalShipCells → setupBoard
// "이 지표가 어떤 관측과 행동에 의존하는지" 한 눈에

graph.mutates('shoot');
// → cells[*].status, shotsRemaining, shotsFired, lastShotResult, turnNumber

graph.enables('shoot');
// → phase === "playing" && shotsRemaining > 0
```

### 7.2 Explain (Gabe에게 없는 것)

```ts
core.explain(schema, snapshot, 'targetingF1');
// → "2 × (targetingPrecision(0.6) × targetingRecall(0.4)) / (0.6 + 0.4) = 0.48"
// 매 턴 "왜 이 점수인지" 수학적 trace
```

### 7.3 Snapshot 가독성

Gabe의 Captain은 "current board state and the full game history"를 텍스트 프롬프트로 받는다.
Manifesto의 Captain은 **구조화된 snapshot** (state + computed + 인과그래프)을 받는다.

차이: Manifesto snapshot에는 `hitRate`, `progress`, `targetingF1`, `shipCellsRemaining` 등 파생 값이 이미 계산되어 있고, 이들 간의 인과 관계가 명시적이다. LLM이 raw 보드 상태에서 이런 값을 스스로 계산할 필요가 없다.

---

## 8. 실험 프로토콜

### 8.1 환경

- Gabe의 **18개 보드** 컨텍스트 사용 (동일 조건)
- 보드당 **3게임 × 3 seed** × 18보드 = **54게임** (Gabe 논문과 동일)
- **8×8 보드**, shots 40, questions 15
- LLM: Claude Sonnet 4.6 (질문 생성 + 평가 함수 출력)
- SMC particles: 500개 (Gabe 논문 참조)
- Spotter: oracle (ε=0) — 1차 실험
- γ = 0.95 (D_Bayes discount factor)

### 8.2 비교 에이전트

| Agent | 구성 | 비교 대상 |
|-------|------|----------|
| **Manifesto-LM** | MEL + LLM snapshot 읽기만 (Bayesian 없음) | Gabe의 LM-only |
| **Manifesto-Bayes** | MEL + SMC + Q/M/D_Bayes + LLM 질문 생성 | Gabe의 +Bayes-QMD |
| **Manifesto-Greedy** | MEL + SMC + M_Bayes만 (질문 안 함) | Gabe의 Greedy |
| **Manifesto-Random** | 랜덤 사격/질문 | Gabe의 Random |

### 8.3 측정 지표 (Gabe 논문과 동일)

| Metric | 정의 |
|--------|------|
| **Targeting F1** | `2 × precision × recall / (precision + recall)`, precision = hits/shots, recall = hits/totalShipCells |
| **Move Count** | 평균 사격 수 (max 40) |
| **Questions Asked** | 평균 질문 수 (max 15) |
| **Win Rate** | board-matched head-to-head 비교 (F1 기준, 동점 시 fewer moves 승) |
| **EIG** | 질문의 평균 Expected Information Gain (bits, max = 1 - H_b(0.1) = 0.531) |

추가 지표 (Manifesto 고유):

| Metric | 의미 |
|--------|------|
| 도메인 코드량 | MEL 줄 수 |
| 인과 추적 시연 | SchemaGraph + explain 가능 여부 |
| 결정 시간 | captainTurn 평균 ms |

---

## 9. 산출물

```
1. battleship.mel           — 도메인 정의 (컴파일 통과)
2. src/domain/              — 컴파일된 schema + effect handlers
3. src/agent/captain.ts     — Captain 에이전트 (SMC + Bayes + LLM)
4. src/agent/particles.ts   — SMC Particle Set 관리
5. src/agent/spotter.ts     — Spotter oracle
6. src/experiment/runner.ts  — 18보드 × N게임 자동 실행
7. results/                  — 게임별 결과 CSV + 비교 테이블
8. src/demo/causal.ts       — 인과 그래프 + explain 시연 스크립트
```

---

## 10. 타임라인

| Day | 작업 | 산출물 |
|-----|------|--------|
| 1 | `battleship.mel` 컴파일 + 18개 보드 로딩 + Spotter oracle | MEL + board loader + spotter |
| 2 | SMC Particle Set + M_Bayes + Greedy agent | particles.ts + greedy 실행 |
| 3 | Q_Bayes (LLM 질문 생성) + D_Bayes + full Captain | captain.ts + 전체 실험 |
| 4 | 결과 수집 + Gabe Table 비교 + 인과 그래프 시연 | results + demo |

---

## 11. 성공 기준

**MUST:**
- Targeting F1 > 0.4 (Gabe의 LM-only GPT-4o 수준 이상)
- 18개 보드 전체 실험 완료
- 인과 그래프 + explain 시연 동작

**SHOULD:**
- Targeting F1 > 0.55 (인간 수준 초과)
- Win Rate > 50% (head-to-head)
- EIG > 0.15 bits/question

**NICE TO HAVE:**
- Targeting F1 > 0.70 (Gabe +Bayes-QMD 수준 근접)
- "37줄 MEL vs 2000줄 Python" 데모가 설득력 있게 시연

---

## 12. Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| `battleship.mel` 컴파일 실패 | 전체 차단 | 컴파일러 맞추는 건 1일이면 해결 |
| LLM이 evaluate 함수를 잘못 생성 | EIG 계산 오류 | 고정 질문 템플릿 fallback (행/열/영역) |
| SMC particle 퇴화 | 후반부 성능 저하 | ESS 모니터링 + 리샘플링 |
| 8×8 보드 sampling 느림 | 실험 시간 증가 | 초기 500 particles, 필요 시 조정 |
| 성능이 Random 수준 | 시연 가치 없음 | M_Bayes만으로도 Greedy보다 유의미한 개선 |
| LLM API 비용 | 예산 초과 | K=10 후보, 54게임이면 ~800 LLM calls |

---

## 13. Gabe에게 보낼 메시지 (성공 시)

```
Hi Gabe,

I reimplemented your Collaborative Battleship (ICLR 2026)
using Manifesto, a deterministic semantic runtime.

Results on your 18-board dataset (54 games):
  Targeting F1: X.XX (vs your Bayes-QMD/GPT-4o: 0.782)
  Win Rate: XX%

Key differences:
  - ~40-line MEL domain definition (vs ~2000 lines Python)
  - No LIPS needed — LLM reads the domain schema, causal graph,
    and structured snapshot directly, then generates both questions
    and evaluation predicates in one step
  - computeSync() serves as the simulation substrate
  - Same Q/M/D_Bayes strategies, same SMC particle set

What Manifesto adds:
  - getSchemaGraph(): static causal dependency graph over the domain
  - explain(): per-value mathematical derivation trace
  - Structured snapshot with pre-computed derived values

The core thesis: a readable world model eliminates the need
for a separate language-to-code translation layer.

Would love to discuss if you find this interesting.

Best,
성우
```

---

*End of EDD v2.0*
