# 설계: Phase Loop — 다중 에이전트 페이즈 기반 워크플로우

> **상태**: 구현 완료

## 개요

Phase Loop는 기존 Agent Loop(1:1), Task Loop(순차 N:1)와 달리 **페이즈 내 병렬 에이전트 + critic 검토 → 다음 페이즈**의 2차원 실행 모델이다.

```
Phase 1: 시장 조사
  ├─ [시장조사관]  gpt-5.1-codex-max   ← 병렬 실행
  ├─ [기술분석가]  gpt-5.1-codex-max   ← 병렬 실행
  ├─ [기획설계자]  gpt-5.2             ← 병렬 실행
  └─ [비평론가]    gpt-5.3-codex-spark ← 전원 완료 후 검토

Phase 2: 전략 수립
  ├─ [전략가]      ...
  ├─ [리스크분석]  ...
  └─ [비평론가]    ...
```

## 기존 루프와의 비교

| | Agent Loop | Task Loop | **Phase Loop** |
|---|---|---|---|
| 실행 단위 | 단일 프롬프트 | 순차 노드 (`TaskNode[]`) | **페이즈 × 병렬 에이전트** |
| 에이전트 수 | 1 | 1/스텝 | **N/페이즈 + critic** |
| 실행 방식 | 동기 | 순차 | **페이즈 내 병렬, 페이즈 간 순차** |
| 대화 | 단일 세션 | 단일 세션 | **에이전트별 독립 세션** |
| 품질 게이트 | 없음 | 없음 | **critic 검토** |
| 상태 | `AgentLoopState` | `TaskState` | **`PhaseLoopState`** |
| 모드 | `"agent"` | `"task"` | **`"phase"`** |

## 타입 설계

### PhaseLoopState (contracts.ts 확장)

```typescript
interface PhaseLoopState {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_user_input";

  /** 현재 실행 중인 페이즈 인덱스 (0-based). */
  current_phase: number;
  phases: PhaseState[];
  memory: Record<string, unknown>;
}

interface PhaseState {
  phase_id: string;
  title: string;
  status: "pending" | "running" | "reviewing" | "completed" | "failed";

  agents: PhaseAgentState[];
  critic?: PhaseCriticState;
}

interface PhaseAgentState {
  agent_id: string;
  role: string;
  label: string;
  model: string;
  status: "pending" | "running" | "completed" | "failed";

  /** 에이전트와 주고받은 대화 히스토리. */
  messages: PhaseMessage[];
  /** 에이전트의 최종 산출물. */
  result?: string;
  usage?: { input: number; output: number; cost?: number };
}

interface PhaseCriticState {
  agent_id: string;
  model: string;
  status: "pending" | "running" | "completed" | "failed";
  /** critic이 모든 에이전트 결과를 검토한 피드백. */
  review?: string;
  /** 다음 페이즈 진행 승인 여부. */
  approved?: boolean;
  messages: PhaseMessage[];
}

interface PhaseMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}
```

### PhaseLoopRunOptions (loop.types.ts 확장)

```typescript
type PhaseLoopRunOptions = {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  phases: PhaseDefinition[];
  initial_memory?: Record<string, unknown>;
  on_phase_change?: (state: PhaseLoopState) => void;
  on_agent_update?: (phase_id: string, agent_id: string, state: PhaseAgentState) => void;
  abort_signal?: AbortSignal;
};

type PhaseDefinition = {
  phase_id: string;
  title: string;
  agents: PhaseAgentDefinition[];
  critic?: PhaseCriticDefinition;
  /** 이전 페이즈 결과를 에이전트 프롬프트에 주입하는 템플릿. */
  context_template?: string;
};

type PhaseAgentDefinition = {
  agent_id: string;
  role: string;
  label: string;
  /** 에이전트 백엔드 instance_id 또는 provider_type. */
  backend: string;
  model?: string;
  /** 에이전트에게 전달할 시스템 프롬프트. */
  system_prompt: string;
  /** 도구 사용 허용 목록. */
  tools?: string[];
  max_turns?: number;
};

type PhaseCriticDefinition = {
  backend: string;
  model?: string;
  system_prompt: string;
  /** false면 critic 피드백은 기록만, 게이트 없이 다음 페이즈 진행. */
  gate?: boolean;
};
```

## 실행 흐름

```
run_phase_loop(options)
  │
  for each phase in phases:
  │
  ├─ 1. phase.status = "running"
  │     이전 페이즈 결과를 context_template으로 주입
  │
  ├─ 2. 에이전트 병렬 실행
  │     Promise.allSettled(agents.map(run_single_agent))
  │     ├─ run_single_agent(agent_def, phase_context)
  │     │   → AgentBackendRegistry.run(AgentRunOptions)
  │     │   → 실시간 이벤트: on_agent_update(phase_id, agent_id, state)
  │     │   → result 저장 + messages 누적
  │     └─ 각 에이전트 완료 시 즉시 상태 브로드캐스트
  │
  ├─ 3. critic 검토 (선택)
  │     phase.status = "reviewing"
  │     모든 에이전트 result를 critic에게 전달
  │     critic.approved = true → 다음 페이즈
  │     critic.approved = false + gate = true → 재실행 또는 중단
  │
  └─ 4. phase.status = "completed"
        결과를 memory에 병합

  workflow.status = "completed"
```

## 에이전트별 대화 (핵심 차별점)

각 에이전트는 독립 세션을 가지며, 사용자가 **개별 에이전트와 대화**할 수 있다.

### 대화 시나리오

```
[대시보드 UI]
Phase 1: 시장 조사 — 실행 중 (2/3 완료)

  ┌─ 시장조사관 ─────────────┐  ┌─ 기술분석가 ─────────────┐
  │ ✅ 완료 [결과] [대화]      │  │ ✅ 완료 [결과] [대화]      │
  └───────────────────────────┘  └───────────────────────────┘

  ┌─ 기획설계자 ─────────────┐
  │ 🔄 실행 중...             │
  └───────────────────────────┘
```

"대화" 버튼 클릭 → 에이전트와 추가 질의:

```
사용자: "경쟁사 분석에서 A사 빠졌는데 추가해줘"
시장조사관: "A사 분석을 추가하겠습니다. [분석 결과 업데이트]"
→ agent.result 업데이트, agent.messages에 대화 기록
```

### API 설계

```
GET    /api/workflows                           → 워크플로우 목록
GET    /api/workflows/:id                       → 워크플로우 상세 (전체 PhaseLoopState)
POST   /api/workflows                           → 워크플로우 생성/실행

GET    /api/workflows/:id/phases/:pid/agents/:aid/messages  → 에이전트 대화 조회
POST   /api/workflows/:id/phases/:pid/agents/:aid/messages  → 에이전트에 메시지 전송
POST   /api/workflows/:id/phases/:pid/agents/:aid/retry     → 에이전트 재실행

POST   /api/workflows/:id/phases/:pid/critic/messages       → critic에 메시지 전송
POST   /api/workflows/:id/cancel                             → 워크플로우 취소
```

### 세션 키

```
workflow:{workflow_id}:phase:{phase_id}:agent:{agent_id}
```

PTY 백엔드 사용 시 이 키로 PTY handle을 매핑하여 에이전트별 세션 지속성을 확보한다.

## PTY 백엔드와의 결합

Phase Loop는 PTY 백엔드의 이상적인 사용처다:

| Phase Loop 요구사항 | PTY가 해결하는 방식 |
|---------------------|-------------------|
| 에이전트별 독립 세션 | PTY handle per agent |
| 대화 지속성 | PTY 프로세스가 컨텍스트 유지 |
| 병렬 실행 | 독립 PTY → 자연스러운 병렬성 |
| 추가 질의 (대화) | 기존 PTY에 메시지 write |
| 결과 재활용 | 프로세스 내 히스토리 보존 |

PTY 없이도 구현 가능하다 (일반 AgentBackend.run()으로 매번 히스토리 전달). PTY는 **성능 최적화 계층**이지 필수 의존성이 아니다.

## 상태 영속화

### SQLite 스키마

```sql
CREATE TABLE phase_workflows (
  workflow_id  TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  objective    TEXT NOT NULL,
  channel      TEXT NOT NULL,
  chat_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  state_json   TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE phase_agent_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  phase_id     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  at           TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES phase_workflows(workflow_id)
);
CREATE INDEX idx_pam_lookup ON phase_agent_messages(workflow_id, phase_id, agent_id);
```

### SSE 이벤트

```typescript
// 대시보드 실시간 업데이트
type PhaseLoopEvent =
  | { type: "workflow_started"; workflow_id: string }
  | { type: "phase_started"; workflow_id: string; phase_id: string }
  | { type: "agent_started"; workflow_id: string; phase_id: string; agent_id: string }
  | { type: "agent_completed"; workflow_id: string; phase_id: string; agent_id: string; result: string }
  | { type: "agent_message"; workflow_id: string; phase_id: string; agent_id: string; message: PhaseMessage }
  | { type: "critic_started"; workflow_id: string; phase_id: string }
  | { type: "critic_completed"; workflow_id: string; phase_id: string; approved: boolean; review: string }
  | { type: "phase_completed"; workflow_id: string; phase_id: string }
  | { type: "workflow_completed"; workflow_id: string }
  | { type: "workflow_failed"; workflow_id: string; error: string };
```

## 대시보드 확장

### 현재 서브에이전트 UI의 한계

현재 `agents.tsx`에는 서브에이전트 카드와 `SendAgentModal`이 존재하지만:

- `POST /api/agents/:id/send` — fire-and-forget (메시지 전송만, 응답 수신 불가)
- **대화 히스토리 조회 API 없음** — 주고받은 메시지를 볼 수 없음
- 카드에 `last_message` 한 줄만 표시

Phase Loop에서는 이것이 **양방향 채팅 UI**로 확장되어야 한다.

### 필요한 대시보드 변경

| 영역 | 현재 | Phase Loop 확장 |
|------|------|----------------|
| **사이드바** | 7개 페이지 | + `Workflows` 페이지 추가 |
| **서브에이전트 카드** | Send 버튼 (fire-and-forget) | 💬 채팅 패널 (양방향) |
| **메시지 히스토리** | 없음 | `GET /api/.../messages` 조회 + 실시간 SSE |
| **워크플로우 뷰** | 없음 | Phase 트리 + 에이전트 카드 그리드 |
| **분류기 표시** | `once/agent/task` | + `phase` 모드 뱃지 |

### 새 페이지: `/workflows`

```
┌─ Workflows ─────────────────────────────────────────┐
│                                                      │
│ [+ New Workflow]                                     │
│                                                      │
│ ┌─ 시장 조사 ──────────────────┐  ┌─ 경쟁 분석 ─┐  │
│ │ Phase 2/3 · 실행 중           │  │ 완료         │  │
│ │ 6 agents · 2 critics         │  │ 3 agents     │  │
│ │ ████████░░░░ 67%              │  │ ██████ 100%  │  │
│ │ [상세보기]                    │  │ [상세보기]   │  │
│ └──────────────────────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 워크플로우 상세 페이지

```
┌────────────────────────────────────────────────────┐
│ PHASE 1: 시장 조사                                  │
│ 완료 · 3 agents + 1 critic                         │
│ ████████████████████████████████ 3/3 완료           │
│                                                     │
│ ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│ │ 시장조사관  │  │ 기술분석가  │  │ 기획설계자  │       │
│ │ gpt-5.1   │  │ gpt-5.1   │  │ gpt-5.2   │       │
│ │ ✅ 완료    │  │ ✅ 완료    │  │ ✅ 완료    │       │
│ │ [결과][💬] │  │ [결과][💬] │  │ [결과][💬] │       │
│ └───────────┘  └───────────┘  └───────────┘       │
│           └──────────┼──────────┘                   │
│                      ▼                              │
│              ┌──────────────┐                       │
│              │   비평론가     │                       │
│              │ gpt-5.3      │                       │
│              │ ✅ 검토 완료  │                       │
│              │ [결과][💬]    │                       │
│              └──────────────┘                       │
└────────────────────────────────────────────────────┘
│                      ▼
┌────────────────────────────────────────────────────┐
│ PHASE 2: 전략 수립                                  │
│ 대기 중                                             │
└────────────────────────────────────────────────────┘
```

### 에이전트 채팅 패널

"💬" 클릭 시 우측 슬라이드 패널. 현재 `SendAgentModal`(단방향)을 **양방향 채팅 UI**로 대체한다.

```
┌─ 시장조사관 — 채팅 ────────────────────────────────┐
│                                                     │
│ ┌─ 헤더 ──────────────────────────────────────────┐ │
│ │ 🤖 시장조사관  gpt-5.1-codex-max  ✅ 완료       │ │
│ │ Phase 1: 시장 조사                               │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [system] 시장 조사 전문가 역할...                    │
│                                                     │
│ [assistant] 조사 결과:                               │
│   - 글로벌 시장 규모: $4.2T                          │
│   - 연평균 성장률: 8.2%                              │
│   - 주요 플레이어: ...                               │
│                                                     │
│ [← ask_agent 수신] 기술분석가로부터:                  │
│   "3nm 공정 현황 공유합니다: ..."                     │
│                                                     │
│ [user] 경쟁사 A사도 분석해줘                         │
│                                                     │
│ [assistant] A사 분석 추가:                            │
│   - 매출: $12.3B                                     │
│   - 시장점유율: 15%                                  │
│                                                     │
│ ┌─────────────────────────────────────┐ [전송]      │
│ │ 메시지 입력...                       │             │
│ └─────────────────────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

채팅 패널 기능:
- **실시간 업데이트**: SSE `agent_message` 이벤트로 새 메시지 자동 추가
- **에이전트 간 통신 표시**: `ask_agent` 호출/응답을 별도 스타일로 표시
- **결과 확인**: 에이전트의 최종 `result`를 상단 또는 별도 탭으로 표시
- **재실행**: 에이전트를 초기 프롬프트로 재실행하는 버튼

### 기존 서브에이전트 카드 확장

현재 `agents.tsx`의 서브에이전트 카드도 Phase Loop 이전에 채팅 기능으로 확장 가능하다:

```
현재:
  ┌─ worker-abc ─────────────┐
  │ role · model              │
  │ RUNNING                   │
  │ last_message 한 줄         │
  │ [Cancel] [Send]           │  ← fire-and-forget
  └───────────────────────────┘

확장:
  ┌─ worker-abc ─────────────┐
  │ role · model              │
  │ RUNNING                   │
  │ last_message 한 줄         │
  │ [Cancel] [💬 Chat]        │  ← 채팅 패널 열기
  └───────────────────────────┘
```

`Send` → `💬 Chat` 전환. 클릭 시 동일한 채팅 패널이 열리며, 이를 위해 필요한 API:

```
GET  /api/agents/:id/messages   → 서브에이전트 대화 히스토리 조회
POST /api/agents/:id/send       → 메시지 전송 (기존 API 재활용)
SSE  agent_message 이벤트        → 실시간 응답 수신
```

## 에이전트 간 자율 통신

Phase 내 에이전트들이 PTY로 동시에 살아있으므로, orchestrator를 경유하지 않고 **에이전트끼리 직접 대화**할 수 있다.

### 통신 메커니즘

각 에이전트에 `ask_agent` 도구를 제공한다:

```typescript
// 에이전트가 사용하는 도구
type AskAgentTool = {
  name: "ask_agent";
  parameters: {
    agent_id: string;   // 같은 페이즈 내 에이전트 ID
    message: string;    // 질문 내용
  };
};

// 내부 구현
async function ask_agent(agent_id: string, message: string): Promise<string> {
  const pty = pool.get(agent_id);
  pty.write(message);
  return pty.read_until_complete();
}
```

### 통신 토폴로지

```
Hub-and-Spoke (현재)          Mesh (PTY 자율 통신)

  시장조사관                    시장조사관 ←→ 기술분석가
       ↕                           ↕    ╲   ↕
  Orchestrator                 기획설계자 ←→ 비평론가
       ↕
  기술분석가
       ↕
  기획설계자
```

### 시나리오

```
시장조사관: "반도체 시장 규모를 분석 중인데, 최신 공정 기술 현황이 필요해"
  → ask_agent("기술분석가", "3nm/2nm 공정 기술 현황과 주요 팹 업체 알려줘")
  ← 기술분석가: "TSMC N3E 양산 중, Samsung 2nm GAA 2025 예정..."
시장조사관: (기술 데이터를 반영하여 시장 규모 분석 완료)
```

Orchestrator 개입 없이 에이전트가 자체 판단으로 다른 에이전트에 질문한다.

### 안전장치

| 위험 | 방어 |
|------|------|
| 무한 루프 (A→B→A→B...) | 호출 depth 카운터 (`max_depth=3`) |
| 비용 폭발 | 워크플로우 단위 토큰 예산 |
| 동시성 충돌 | PTY당 mutex (한 번에 하나의 요청만 처리) |
| 데드락 | A가 B를 기다리는데 B가 A를 기다림 → timeout (30초) |
| 범위 제한 | 같은 페이즈 내 에이전트만 통신 가능 |

### PhaseAgentDefinition 확장

```typescript
type PhaseAgentDefinition = {
  // ... 기존 필드
  /** 이 에이전트가 대화할 수 있는 다른 에이전트 ID 목록. 비어있으면 통신 불가. */
  can_talk_to?: string[];
  /** ask_agent 호출의 최대 depth. 기본값 3. */
  max_comm_depth?: number;
};
```

## 오케스트레이션 통합

### 모드 분류 확장

```typescript
type ExecutionMode = "once" | "agent" | "task" | "phase";
```

현재 분류기(orchestrator LLM)가 `once/agent/task/inquiry/builtin`을 판별한다. `phase` 모드 추가 시:

**분류기 프롬프트 확장**:
```
기존 분류:
- once: 단순 질문, 단일 도구 호출
- agent: 다단계 작업, 복수 도구 필요
- task: 장기 실행, 단계별 체크포인트

추가:
- phase: 다수 전문가가 병렬로 분석/작업 후 종합이 필요한 요청
  예: "시장 조사해줘", "이 프로젝트 전체 리뷰해줘", "경쟁사 분석 + 기술 분석 + 전략 수립"
```

**Phase 모드 진입 조건**:
1. 사용자가 `/workflow` 커맨드로 명시적 요청
2. 대시보드 Workflows 페이지에서 워크플로우 생성
3. 분류기가 `phase`로 판별 → `workspace/workflows/`에서 매칭되는 워크플로우 템플릿 탐색
4. 매칭 없으면 동적 워크플로우 생성 (에이전트 역할/수를 분류기가 결정)

**분류기 출력 스키마 확장**:
```typescript
// 현재
type ClassificationResult =
  | { mode: "once" | "agent" | "task" }
  | { mode: "inquiry" }
  | { mode: "builtin"; command: string; args?: string };

// 확장
type ClassificationResult =
  | { mode: "once" | "agent" | "task" }
  | { mode: "inquiry" }
  | { mode: "builtin"; command: string; args?: string }
  | { mode: "phase"; workflow_id?: string; suggested_agents?: string[] };
```

### 워크플로우 정의 형식

```yaml
# workspace/workflows/market-research.yaml
title: 시장 조사
objective: "{{topic}}에 대한 종합 시장 분석"

phases:
  - phase_id: research
    title: 시장 조사
    agents:
      - role: 시장조사관
        backend: openrouter
        model: gpt-5.1-codex-max
        system_prompt: "시장 규모, 성장률, 트렌드를 분석하라."
        tools: [web_search]
      - role: 기술분석가
        backend: openrouter
        model: gpt-5.1-codex-max
        system_prompt: "기술 스택, 특허, 기술 트렌드를 분석하라."
        tools: [web_search]
      - role: 기획설계자
        backend: openai_compatible
        model: gpt-5.2
        system_prompt: "비즈니스 모델, 수익 구조, 진입 전략을 설계하라."
    critic:
      backend: openrouter
      model: gpt-5.3-codex-spark
      system_prompt: "모든 분석의 논리적 일관성, 데이터 근거, 누락 항목을 검토하라."
      gate: true

  - phase_id: strategy
    title: 전략 수립
    context_template: |
      ## 이전 페이즈 결과
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
      ### Critic 피드백
      {{prev_phase.critic.review}}
    agents:
      - role: 전략가
        ...
```

## 설계 결정 사항

이전 논의에서 식별된 7개 설계 갭에 대한 구체적 결정.

### 1. PTY 입출력 프로토콜

PTY stdin/stdout을 통한 NDJSON 와이어 포맷.

**입력 (orchestrator → PTY)**:
```json
{"type":"user_message","content":"시장 규모를 분석해줘","metadata":{"phase_id":"research","turn":1}}
{"type":"ask_agent_request","from":"tech_analyst","content":"3nm 공정 현황 알려줘","request_id":"req-001"}
```

**출력 (PTY → orchestrator)**:
```json
{"type":"assistant_chunk","content":"분석을 시작합니다...","delta":true}
{"type":"tool_use","tool":"web_search","input":{"query":"semiconductor market 2025"}}
{"type":"tool_result","tool":"web_search","output":"...검색 결과..."}
{"type":"assistant_message","content":"글로벌 반도체 시장 규모는..."}
{"type":"complete","result":"최종 분석 결과...","usage":{"input":1200,"output":800}}
```

**완료 감지**: `{"type":"complete"}` 이벤트가 턴의 끝을 표시. `read_until_complete()`는 이 이벤트까지 버퍼링 후 반환.

**에러**: `{"type":"error","code":"timeout"|"crash"|"token_limit","message":"..."}` — 에러도 턴 종료로 취급.

### 2. 메시지 영속화 아키텍처

PTY는 I/O 전송만 담당하고, 영속화는 **인터셉터 계층**이 처리한다.

```
Orchestrator
  │
  ├─ PtyMessageInterceptor  ← 모든 PTY I/O를 가로챔
  │    ├─ DB 기록: phase_agent_messages INSERT
  │    ├─ SSE 방출: agent_message 이벤트
  │    ├─ PhaseAgentState.messages 업데이트
  │    └─ 통과: 원본 메시지를 소비자에게 전달
  │
  └─ PTY[agent]
```

```typescript
class PtyMessageInterceptor {
  constructor(
    private db: PhaseWorkflowStore,
    private sse: SSEBroadcaster,
    private state: PhaseAgentState,
  ) {}

  /** PTY에 메시지를 쓰기 전 기록. */
  on_input(msg: PtyInputMessage): void {
    this.db.insert_message(this.state.agent_id, "user", msg.content);
    this.state.messages.push({ role: "user", content: msg.content, at: now() });
  }

  /** PTY 출력을 소비자에게 전달하기 전 기록. */
  on_output(msg: PtyOutputMessage): void {
    if (msg.type === "assistant_message" || msg.type === "complete") {
      this.db.insert_message(this.state.agent_id, "assistant", msg.content);
      this.state.messages.push({ role: "assistant", content: msg.content, at: now() });
      this.sse.emit({ type: "agent_message", ...ids, message: last(this.state.messages) });
    }
  }
}
```

PTY 자체는 영속화를 모른다 → 관심사 분리. 비-PTY 백엔드도 동일 인터셉터를 사용한다.

### 3. ask_agent 동시성 정책

대상 에이전트가 busy 상태일 때: **큐잉 + 타임아웃**.

```
ask_agent("tech_analyst", "3nm 현황")
  │
  ├─ tech_analyst idle?
  │   yes → 즉시 처리, mutex 획득
  │   no  → 큐에 삽입
  │
  ├─ 큐 깊이 ≤ 3?
  │   yes → 대기 (timeout: 30초)
  │   no  → 즉시 거절 { error: "agent_busy", retry_after_ms: 5000 }
  │
  └─ 타임아웃?
      yes → { error: "agent_timeout", message: "tech_analyst did not respond within 30s" }
```

**결정 근거**:
- 즉시 거절(reject)은 호출자가 재시도 로직을 구현해야 함 → 복잡도 증가
- 무한 대기(block)는 데드락 위험
- 큐잉(queue) + 깊이 제한 + 타임아웃이 최적 균형

**데드락 방지**: A→B, B→A 동시 호출 감지. 요청 그래프에 사이클이 있으면 후발 요청을 `{ error: "deadlock_detected" }`로 즉시 거절.

### 4. 페이즈 실패 정책

페이즈 내 에이전트 일부가 실패할 때의 동작. **per-phase 설정**.

```typescript
type PhaseDefinition = {
  // ... 기존 필드
  /** 에이전트 실패 시 동작. 기본값: "best_effort" */
  failure_policy?: "fail_fast" | "best_effort" | "quorum";
  /** quorum 정책 시 필요한 최소 성공 수. */
  quorum_count?: number;
};
```

| 정책 | 동작 | 사용 사례 |
|------|------|----------|
| `fail_fast` | 하나라도 실패 → 페이즈 즉시 실패 | 모든 에이전트 결과가 필수인 경우 |
| `best_effort` | 가능한 에이전트만으로 계속 진행 | 분석/조사 (일부 누락 허용) |
| `quorum` | N개 이상 성공 시 진행, 미만이면 실패 | 투표/합의 기반 결정 |

**기본값**: `best_effort` — 분석/조사 워크플로우에서 가장 실용적.

**실패 에이전트 처리**:
- `PhaseAgentState.status = "failed"`, `error` 필드에 원인 기록
- Critic에게 전달 시 실패 에이전트 결과 제외, 실패 사실만 알림
- SSE `agent_failed` 이벤트 방출 (기존 이벤트에 추가)

```typescript
// SSE 이벤트 추가
| { type: "agent_failed"; workflow_id: string; phase_id: string; agent_id: string; error: string }
```

### 5. Critic 거절 시 재시도 전략

Critic이 `approved = false`를 반환했을 때의 동작. **per-critic 설정**.

```typescript
type PhaseCriticDefinition = {
  // ... 기존 필드
  /** critic 거절 시 동작. 기본값: "escalate" */
  on_rejection?: "retry_all" | "retry_targeted" | "escalate";
  /** 최대 재시도 횟수. 기본값: 1 */
  max_retries?: number;
};
```

| 전략 | 동작 | 비용 영향 |
|------|------|----------|
| `retry_all` | 전체 에이전트 재실행 (critic 피드백 주입) | 높음 (N × 재시도) |
| `retry_targeted` | critic이 지목한 에이전트만 재실행 | 중간 |
| `escalate` | 사용자에게 결정 위임 (continue/retry/abort) | 없음 (대기) |

**기본값**: `escalate` — 비용 통제 + 사용자 의사결정 보장.

**재시도 시 피드백 주입**:
```
[system] 이전 시도에서 critic이 다음 피드백을 제공했습니다:
---
{critic.review}
---
이 피드백을 반영하여 분석을 개선하세요.
```

**escalate 흐름**:
```
workflow.status = "waiting_user_input"
  → SSE: { type: "critic_rejected", workflow_id, phase_id, review }
  → 대시보드: 사용자에게 3가지 선택지 제시
    1. "Continue" → critic 피드백 무시, 다음 페이즈로
    2. "Retry" → 재실행 (retry_all 또는 retry_targeted 선택)
    3. "Abort" → 워크플로우 취소
```

**Critic 피드백 구조 정규화** (targeted retry를 위해):
```typescript
interface CriticReview {
  approved: boolean;
  summary: string;
  /** 에이전트별 평가. targeted retry 시 low_quality 에이전트만 재실행. */
  agent_reviews?: Array<{
    agent_id: string;
    quality: "good" | "needs_improvement" | "low_quality";
    feedback: string;
  }>;
}
```

### 6. 동적 워크플로우 생성

템플릿 매칭 실패 시 LLM이 워크플로우를 자동 생성하는 메커니즘.

**2단계 프로세스**:

```
1. 분류기: { mode: "phase", workflow_id: undefined }
2. 템플릿 탐색: workspace/workflows/*.yaml → 매칭 없음
3. 워크플로우 플래너 호출 (별도 LLM 턴)
4. 생성된 PhaseDefinition[] → DB 저장 → 실행
```

**워크플로우 플래너 프롬프트**:
```
사용자 목표: "{objective}"

사용 가능한 백엔드: [{backend_id, provider, models}]
사용 가능한 도구: [{name, description}]

다음 제약 내에서 워크플로우를 설계하세요:
- 최대 페이즈 수: 3
- 페이즈당 최대 에이전트 수: 5
- 각 에이전트에 명확한 역할과 system_prompt를 부여
- 순차적 의존성이 있는 작업은 별도 페이즈로 분리
- critic은 gate=true로 설정 (품질 보증)

JSON 출력 형식: PhaseDefinition[]
```

**생성된 워크플로우 저장**: DB `phase_workflows` 테이블에 `source: "generated"` 태그. 파일시스템에 저장하지 않음 (일회성).

**사용자 확인**: 생성된 워크플로우를 사용자에게 미리보기로 제시 → 승인 후 실행. 자동 실행 금지 (비용 통제).

```
[대시보드 또는 채널]
🤖 다음 워크플로우를 생성했습니다:

Phase 1: 시장 조사 (3 agents + critic)
  - 시장조사관: 시장 규모, 성장률 분석
  - 기술분석가: 기술 트렌드 분석
  - 경쟁사분석가: 주요 경쟁사 비교

Phase 2: 전략 수립 (2 agents + critic)
  - 전략가: 진입 전략 수립
  - 리스크분석가: 위험 요인 평가

[실행] [수정] [취소]
```

### 7. 병렬 에이전트 파일시스템 충돌

병렬 에이전트가 동시에 파일을 수정할 때의 충돌 방지.

**에이전트 유형에 따른 전략**:

| 유형 | 파일시스템 접근 | 격리 전략 |
|------|---------------|----------|
| 분석/조사 에이전트 | 읽기 전용 + 텍스트 출력 | 격리 불필요 |
| 코드 작성 에이전트 | 읽기/쓰기 | 워크트리 격리 |
| 혼합 (분석+코드) | 읽기/쓰기 | 워크트리 격리 |

**워크스페이스 디렉토리 구조**:
```
workspace/workflows/{workflow_id}/
  ├─ shared/              ← orchestrator가 작성, 에이전트 읽기 전용
  │   ├─ context.md       ← 이전 페이즈 결과
  │   └─ objective.md     ← 워크플로우 목표
  ├─ agents/
  │   ├─ market_analyst/  ← 에이전트 전용 작업 디렉토리
  │   ├─ tech_analyst/
  │   └─ strategist/
  └─ output/              ← 최종 병합 결과
```

**코드 작성 시나리오 (git 워크트리)**:
```
git worktree add .worktrees/{agent_id} -b workflow/{workflow_id}/{agent_id}

Phase 완료 후:
  1. 각 에이전트 브랜치의 diff 수집
  2. 충돌 검사 (겹치는 파일 변경)
  3. 충돌 없음 → 자동 머지
  4. 충돌 있음 → critic에게 해결 위임 또는 사용자 escalate
```

**PhaseAgentDefinition 확장**:
```typescript
type PhaseAgentDefinition = {
  // ... 기존 필드
  /** 파일시스템 격리 모드. 기본값: "none" */
  filesystem_isolation?: "none" | "directory" | "worktree";
};
```

- `none`: 격리 없음 (분석 에이전트, 텍스트 출력만)
- `directory`: 전용 디렉토리 할당, 다른 에이전트 디렉토리 접근 불가
- `worktree`: git worktree로 완전 격리 (코드 수정 에이전트)

## 관련 문서

→ [PTY 기반 에이전트 백엔드](./pty-agent-backend.md)
→ [에이전트 시스템](../core-concepts/agents.md)
→ [프로바이더 설정 가이드](../guide/providers.md)
