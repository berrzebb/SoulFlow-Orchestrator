# 설계: Interactive Phase + Fresh Context Loop

> **상태**: 구현 완료

## 개요

Phase Loop에 기본 "parallel" 모드 외 두 가지 실행 모드를 추가:

1. **Interactive 모드** — 에이전트가 사용자와 대화하며 명세/요구사항을 함께 작성
2. **Sequential Loop 모드** — 같은 에이전트를 매 반복 fresh context로 spawn (Ralph Loop 패턴)

두 모드 모두 **HITL (Human-in-the-Loop)** 을 원래 채널(Slack/Telegram/대시보드)을 통해 지원.

## 동기

기존 parallel 모드는 모든 에이전트를 동시 실행하고 결과를 수집한다. 하지만 두 가지 핵심 워크플로우를 표현할 수 없다:

- **대화를 통한 명세 작성**: 에이전트가 사용자에게 질문하고, 명세를 반복 개선하며, 최종 문서를 출력. 일회성 병렬 실행이 아닌 왕복 대화가 필요.
- **Fresh context로 장기 구현**: 작업 목록을 하나씩 실행하되, 매번 새 에이전트 세션으로 context rot를 방지. 결과는 에이전트 context window가 아닌 외부 state에 누적.

## Phase 실행 모드

```
mode: "parallel"         (기본값) — 모든 에이전트 동시 실행
mode: "interactive"      — 단일 에이전트가 채널을 통해 사용자와 대화
mode: "sequential_loop"  — 에이전트를 반복 spawn, 매번 fresh context
```

### Parallel (기존)

```
Phase: Research
  ├─ [Agent A] ──→ result A
  ├─ [Agent B] ──→ result B  ← 동시 실행
  └─ [Agent C] ──→ result C
       └─ [Critic] 전체 리뷰
```

### Interactive

```
Phase: 명세 작성
  ┌─ [Spec Writer] spawn #1
  │   출력: [ASK_USER] 어떤 프레임워크를 선호하세요?
  │   ← 사용자: React
  │
  ├─ [Spec Writer] spawn #2 (fresh context + 대화 이력)
  │   출력: [ASK_USER] SSR을 포함할까요?
  │   ← 사용자: 네, Next.js로
  │
  └─ [Spec Writer] spawn #N
      출력: [SPEC_COMPLETE] { 전체 명세 문서 }
      → Phase 완료, 결과가 다음 phase로 전달
```

### Sequential Loop (Fresh Context)

```
Phase: 구현
  ┌─ [Implementer] spawn #1 (작업 1)
  │   출력: "인증 모듈 완료"
  │
  ├─ [Implementer] spawn #2 (작업 2, fresh context + 이전 결과)
  │   출력: "API 엔드포인트 완료"
  │
  ├─ [Implementer] spawn #3 (작업 3)
  │   출력: [ASK_USER] 어떤 DB 드라이버를 사용할까요?
  │   ← 사용자: PostgreSQL
  │
  └─ [Implementer] spawn #N
      출력: [DONE]
      → 루프 종료
```

## 타입 확장

### PhaseDefinition

```typescript
interface PhaseDefinition {
  // 기존 필드...
  mode?: "parallel" | "interactive" | "sequential_loop";
  loop_until?: string;          // "plan_complete" | "max_iterations"
  max_loop_iterations?: number; // 기본: 20 (interactive), 50 (sequential_loop)
}
```

### PhaseState

```typescript
interface PhaseState {
  // 기존 필드...
  loop_iteration?: number;
  loop_results?: string[];
  pending_user_input?: boolean;
}
```

### PhaseLoopRunOptions

```typescript
interface PhaseLoopRunOptions {
  // 기존 필드...
  ask_user?: (question: string) => Promise<string>;
}
```

### 새 SSE 이벤트

```typescript
| { type: "user_input_requested"; workflow_id: string; phase_id: string; question: string }
| { type: "user_input_received"; workflow_id: string; phase_id: string }
| { type: "loop_iteration"; workflow_id: string; phase_id: string; iteration: number }
```

## 에이전트 출력 마커

| 마커 | 모드 | 효과 |
|------|------|------|
| `[ASK_USER]` | interactive / sequential_loop | 워크플로우 일시정지, 사용자 채널로 질문 전송, 응답 대기 |
| `[SPEC_COMPLETE]` | interactive | interactive phase 종료, 결과를 다음 phase로 전달 |
| `[DONE]` | sequential_loop | 루프 종료 |

## HITL 채널 연결

### ask_user 콜백

```typescript
const ask_user = async (question: string): Promise<string> => {
  await send_to_channel(state.channel, state.chat_id, question);
  return new Promise((resolve) => {
    pending_responses.set(workflow_id, resolve);
  });
};
```

### 응답 해소

`waiting_user_input` 상태의 워크플로우에 사용자가 메시지를 보내면, 대기 중인 Promise가 resolve되고 워크플로우가 재개된다.

### 채널 설정

워크플로우는 기본적으로 트리거한 채널/chat_id를 상속. YAML로 선택적 오버라이드 가능:

```yaml
hitl_channel: "slack"
hitl_chat_id: "C1234567"
```

## YAML 예시

```yaml
title: "자율 개발 파이프라인"
objective: "{{objective}}"

phases:
  - phase_id: "spec"
    title: "명세 작성"
    mode: interactive
    max_loop_iterations: 20
    agents:
      - agent_id: "spec-writer"
        role: "pm"
        system_prompt: |
          사용자와 대화하여 구현 명세를 작성하세요.
          질문이 있으면 [ASK_USER]를 앞에 붙여 질문하세요.
          명세가 완성되면 [SPEC_COMPLETE]를 출력하세요.

  - phase_id: "plan"
    title: "구현 계획"
    mode: parallel
    agents:
      - agent_id: "planner"
        role: "pl"
        system_prompt: "명세를 번호가 매겨진 원자적 작업들로 분해하세요."

  - phase_id: "implement"
    title: "작업 실행"
    mode: sequential_loop
    max_loop_iterations: 50
    agents:
      - agent_id: "implementer"
        role: "implementer"
        system_prompt: |
          계획에서 다음 미완료 작업을 실행하세요.
          막히면 [ASK_USER]로 사용자에게 질문하세요.
          모든 작업 완료 시 [DONE]을 출력하세요.
        tools: ["shell", "file_request"]
```

## 자율 개발 파이프라인 (메타 워크플로우 템플릿)

interactive + sequential_loop 모드의 집대성: 인간의 개발 워크플로우 "명세 → 계획 → 구현 → 리뷰 → 수정 → 검증"을 자동화하는 완전한 파이프라인.

### 파이프라인 구조

```
Phase 1: 명세 작성 (interactive)
  └─ [PM] ←→ 사용자 — 대화를 통해 구현 명세 공동 작성
       │
Phase 2: 구현 계획 (parallel)
  └─ [PL] — 명세를 원자적 작업으로 분해 + 팀 구성
       │      └─ Critic gate: 계획 완전성 검증
       │
Phase 3: 구현 (sequential_loop)
  └─ [Implementer] — 작업을 하나씩 실행, 매 반복 fresh context
       │                └─ [ASK_USER] 막히면 사용자에게 질문
       │
Phase 4: 코드 리뷰 (parallel)
  └─ [Reviewer] — 모든 변경사항 검토 (정확성, 스타일, 보안)
       │        └─ Critic gate: 리뷰 철저성 검증
       │
Phase 5: 이슈 수정 (sequential_loop)
  └─ [Debugger] — 리뷰에서 발견된 이슈 하나씩 수정
       │            └─ 이슈 없으면 즉시 [DONE]으로 스킵
       │
Phase 6: 동작 검증 (parallel)
  └─ [Validator] — 빌드, 테스트, 타입체크, 인수 기준 검증
                 └─ Critic: 최종 판정
```

### 역할 자동 투여

템플릿이 파이프라인 구조를 사전 정의. 각 Phase가 적절한 역할(pm, pl, implementer, reviewer, debugger, validator)을 `src/skills/roles/`에서 자동 주입. 사용자가 수동으로 에이전트를 배정할 필요 없이 메타 템플릿이 처리.

핵심 원칙: **구조는 고정, 내용은 동적**. PL의 계획 출력이 implementer가 실행할 작업, 필요한 반복 횟수, reviewer가 확인할 항목을 결정.

### 템플릿 파일

`workspace/workflows/autonomous-dev-pipeline.yaml` — 6단계 메타 템플릿.

## 대시보드 UX (모드별 카드)

Phase 모드별로 다른 카드 표현이 필요:

### Parallel 모드 (기존)

```
┌─ Phase: 리서치 ──────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│ │ Analyst  │ │ Scout    │ │ Writer   │  │
│ │ ✅ 완료   │ │ 🔄 실행   │ │ ⏳ 대기   │  │
│ │ [결과]   │ │ [결과]   │ │          │  │
│ └──────────┘ └──────────┘ └──────────┘  │
│ ████████████░░░░░ 2/3 에이전트 완료       │
└──────────────────────────────────────────┘
```

### Interactive 모드 — 채팅 UI

```
┌─ Phase: 명세 작성 ──── 🔄 대화형 ────────┐
│                                             │
│  🤖 PM: 어떤 프레임워크를 선호하세요?        │
│                          사용자: React 👤   │
│                                             │
│  🤖 PM: SSR을 포함할까요?                   │
│                   사용자: 네, Next.js 👤    │
│                                             │
│  🤖 PM: 최종 명세 작성 중...                 │
│                                             │
│ ┌─────────────────────────────────┐ [전송] │
│ │ 응답을 입력하세요...             │         │
│ └─────────────────────────────────┘         │
│ 턴 3/20                                     │
└─────────────────────────────────────────────┘
```

### Sequential Loop 모드 — 반복 타임라인

```
┌─ Phase: 구현 ──── 🔁 순차 루프 ───────────┐
│                                             │
│  ✅ #1  인증 모듈 완료                 0:42 │
│  ✅ #2  API 엔드포인트 완료            1:15 │
│  ❓ #3  [ASK_USER] 어떤 DB 드라이버?       │
│         └─ 사용자: PostgreSQL               │
│  🔄 #4  데이터베이스 레이어 구현 중...       │
│  ⏳ #5-8  남은 작업                         │
│                                             │
│ ████████████░░░░░░ 4/50 반복                │
└─────────────────────────────────────────────┘
```

## Phase 분기: Goto + Fork-Join

### Critic 기반 되돌리기 (Goto)

파이프라인은 단방향이 아님. 검증 실패 시 이전 Phase로 되돌아감:

```
implement → review → validate ──PASS──→ 완료
                       │
                      FAIL (critic 거부)
                       │
                       ↓ on_rejection: goto → goto_phase: "fix"
                      fix → review → validate (재검증)
```

`PhaseCriticDefinition` 확장:

```typescript
interface PhaseCriticDefinition {
  // 기존...
  on_rejection?: "retry_all" | "retry_targeted" | "escalate" | "goto";
  goto_phase?: string;  // on_rejection이 "goto"일 때 점프할 phase_id
}
```

메인 루프가 선형 반복에서 **phase_id 기반 상태 머신**으로 변경:

```typescript
// 이전: 선형
for (let i = 0; i < phases.length; i++) { ... }

// 이후: 점프 가능한 상태 머신
let phase_idx = 0;
while (phase_idx < phases.length) {
  // ... phase 실행 ...
  if (critic이 거부 && on_rejection === "goto") {
    phase_idx = phases.findIndex(p => p.phase_id === goto_phase);
    // 대상 phase 상태 리셋
    continue;
  }
  phase_idx++;
}
```

YAML 예시:
```yaml
- phase_id: "validate"
  critic:
    system_prompt: "모든 테스트 통과 여부 검증..."
    gate: true
    on_rejection: goto
    goto_phase: "fix"    # 실패 시 fix phase로 점프
    max_retries: 3       # 최대 goto 루프 횟수, 초과 시 사용자에게 에스컬레이션
```

### Fork-Join (병렬 분기)

여러 Phase가 동시에 실행. 모두 성공해야 다음 Phase로 진행:

```
Phase: 리서치
  ├─ 분기 A: 코드베이스 분석    ─┐
  ├─ 분기 B: API 리서치          ├─ 전부 완료 → Phase: 계획 수립
  └─ 분기 C: 패턴 조사          ─┘
```

`PhaseDefinition` 확장:

```typescript
interface PhaseDefinition {
  // 기존...
  depends_on?: string[];  // 이 phase 시작 전에 완료되어야 하는 phase_id 목록
}
```

같은 `depends_on`을 가진 Phase들(또는 같은 "레이어"에 `depends_on`이 없는 Phase들)이 동시 실행. 러너가 모든 결과를 수집한 후 의존 Phase로 진행.

YAML 예시:
```yaml
- phase_id: "code-review"
  depends_on: ["implement"]
  agents: [...]

- phase_id: "security-review"
  depends_on: ["implement"]
  agents: [...]

- phase_id: "fix"
  depends_on: ["code-review", "security-review"]  # 둘 다 대기
  agents: [...]
```

## 비주얼 그래프 에디터 (빌더 진화)

빌더가 선형 폼에서 **비주얼 상태 머신 에디터**로 진화:

### 현재: 선형 폼 빌더

```
Phase 1  ──────────→  Phase 2  ──────────→  Phase 3
[폼 필드]             [폼 필드]              [폼 필드]
```

### 목표: 노드-엣지 그래프 에디터

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ┌──────┐     ┌──────┐     ┌──────────┐                │
│   │ 명세 │────→│ 계획 │────→│  구현    │                │
│   │  🔄  │     │  ∥   │     │   🔁     │                │
│   └──────┘     └──────┘     └─────┬────┘                │
│                                   │                      │
│                      ┌────────────┼────────────┐         │
│                      ↓            ↓            ↓         │
│                ┌──────────┐ ┌──────────┐                 │
│                │코드 리뷰 │ │보안 리뷰 │  ← fork         │
│                │  ∥       │ │  ∥       │                 │
│                └────┬─────┘ └────┬─────┘                 │
│                     └─────┬──────┘  ← join               │
│                           ↓                              │
│                     ┌──────────┐                         │
│                     │  수정    │←────────┐               │
│                     │   🔁     │         │  ← goto loop  │
│                     └────┬─────┘         │               │
│                          ↓               │               │
│                     ┌──────────┐         │               │
│                     │  검증    │─FAIL───→┘               │
│                     │  ∥       │                         │
│                     └────┬─────┘                         │
│                          ↓ PASS                          │
│                       ✅ 완료                             │
│                                                          │
│  모드: 🔄 대화형  ∥ 병렬  🔁 순차 루프                    │
└──────────────────────────────────────────────────────────┘
```

### 인터랙션 모델

1. **노드 드래그** — Phase를 캔버스에 배치
2. **엣지 연결** — 노드 간 `depends_on` 관계 설정
3. **노드 클릭** — Phase 설정 패널 열기 (에이전트, critic, 모드)
4. **Goto 엣지** — 빨간 점선으로 "on_fail" 라벨과 함께 표시
5. **Fork/Join** — `depends_on` 토폴로지에서 자동 감지
6. **자동 YAML** — 모든 편집이 즉시 YAML 표현을 재생성
7. **모드 배지** — 각 노드에 실행 모드 아이콘 표시 (🔄/∥/🔁)

### 데이터 흐름

```
그래프 에디터 (비주얼) ←→ WorkflowDefinition (인메모리) ←→ YAML (직렬화)
         ↕                          ↕
    캔버스 렌더링              API 저장/로드
```

그래프 에디터는 `WorkflowDefinition` 위의 **뷰**. 모든 변경이 정의 객체를 업데이트하고, 언제든 YAML로 직렬화 가능. YAML 탭은 직접 편집을 위한 대안으로 제공.

### 멀티 노드 타입

Phase 외에 4가지 보조 노드를 지원. 보조 노드는 Phase에 **부착(attach)** 되어 해당 Phase의 실행 환경을 정의한다.

#### 노드 타입

| 타입 | 모양 | 색상 | 역할 |
|------|------|------|------|
| Phase | 둥근 사각형 | 파랑 (`--accent`) | 에이전트 실행 단위 (기존) |
| Tool | 육각형 | 초록 (`--green`) | Phase에서 사용할 도구 바인딩 |
| Skill | 오각형 | 보라 (`--purple`) | 빌트인 스킬 연결 |
| Cron | 원형 | 주황 (`--orange`) | 워크플로우 트리거 스케줄 |
| Channel | 마름모 | 노랑 (`--yellow`) | HITL 입출력 채널 바인딩 |

#### 연결 규칙 (엣지 타입)

| 엣지 | 방향 | 스타일 | 의미 |
|------|------|--------|------|
| flow | Phase → Phase | 실선 화살표 | `depends_on` 실행 순서 |
| goto | Phase → Phase | 빨간 점선 | `on_fail` 조건부 분기 |
| attach | Tool/Skill → Phase | 회색 점선 | Phase의 `tools[]`/`skills[]`에 ID 추가 |
| trigger | Cron → Phase | 주황 대시선 | 워크플로우 시작 트리거 |
| config | Channel → Workflow | 노랑 대시선 | HITL 채널 바인딩 |

#### 확장된 그래프 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ⏰ Cron ─ ─ ─→ ┌──────┐     ┌──────┐                    │
│   (매일 9시)       │ 명세 │────→│ 구현 │                    │
│                   │  🔄  │     │  🔁  │                    │
│   💬 Channel      └──────┘     └──┬───┘                    │
│   (Slack) ─ ─ ─→  HITL 바인딩     │                        │
│                          ┌────────┼────────┐                │
│                          ↓        ↓        ↓                │
│                    ┌────────┐ ┌────────┐                    │
│                    │코드리뷰│ │보안리뷰│                    │
│                    └───┬────┘ └───┬────┘                    │
│                        └────┬─────┘                         │
│        ⬡ shell ·····→ ┌────────┐                           │
│        ⬡ web   ·····→ │  수정  │ ← 도구 부착               │
│        ⬠ hwpx  ·····→ │  🔁   │ ← 스킬 부착               │
│                       └────────┘                            │
│                                                             │
│  노드: ▭ Phase  ⬡ Tool  ⬠ Skill  ⏰ Cron  💬 Channel      │
└─────────────────────────────────────────────────────────────┘
```

#### 데이터 모델 확장

`WorkflowDefinition`에 보조 노드 필드 추가:

```typescript
interface WorkflowDefinition {
  // 기존...
  tool_nodes?: Array<{ id: string; tool_id: string; description: string }>;
  skill_nodes?: Array<{ id: string; skill_name: string; description: string }>;
  trigger?: { type: "cron"; schedule: string; timezone?: string };
  hitl_channel?: { channel_type: string; chat_id?: string };
}
```

Phase의 `tools[]` / `skills[]` 필드가 보조 노드 ID를 참조하여 연결:

```typescript
interface PhaseDefinition {
  // 기존...
  tools?: string[];   // tool_nodes[].tool_id 참조
  skills?: string[];  // skill_nodes[].skill_name 참조
}
```

#### YAML 표현

```yaml
title: "자동 코드 리뷰"
trigger:
  type: cron
  schedule: "0 9 * * *"
  timezone: "Asia/Seoul"
hitl_channel:
  channel_type: slack
  chat_id: "C1234567"
phases:
  - phase_id: "review"
    title: "코드 리뷰"
    tools: ["shell", "web"]
    skills: ["hwpx"]
    agents:
      - agent_id: "reviewer"
        role: "reviewer"
        label: "코드 리뷰어"
        backend: "claude_cli"
        system_prompt: "코드를 리뷰하세요."
```

#### 레이아웃 전략

- **Tool/Skill** → 연결된 Phase 노드의 왼쪽에 세로로 나열
- **Cron** → 첫 번째 Phase 노드 위에 배치
- **Channel** → 캔버스 상단 우측에 고정 배치
- Phase 간 레이아웃(topological layer)을 먼저 계산한 후, 보조 노드 위치를 Phase 기준으로 산출

#### 빌더 UI

그래프 에디터 상단 툴바에 노드 추가 드롭다운:

```
[+ Phase]  [+ Tool ▼]  [+ Skill ▼]  [⏰ Trigger]  [💬 Channel]
```

- **Tool**: `GET /api/tools` → 등록된 도구 목록에서 선택
- **Skill**: `GET /api/skills` → 활성 스킬 목록에서 선택
- **Cron**: 클릭 시 스케줄(cron 표현식) 입력 모달
- **Channel**: `GET /api/channel-instances` → 채널 인스턴스 선택 드롭다운

## 오케스트레이션 노드 블록

Phase(에이전트) 노드 외에 결정론적 오케스트레이션 노드를 DAG에 삽입할 수 있다.

### 노드 타입

| 노드 | 설명 | 실행 방식 |
|------|------|----------|
| **Phase** | 에이전트 LLM 호출 | SubagentRegistry 기반 |
| **HTTP** | 외부 API 호출 | `fetch()` + 템플릿 변수 |
| **Code** | JS 또는 Shell 실행 | `vm.runInNewContext` / `run_shell_command` |
| **IF** | 조건 분기 | JS 표현식 평가 → true/false 분기 |
| **Merge** | 분기 합류 | `depends_on` 대기 후 데이터 수집 |
| **Set** | 변수 할당 | `memory`에 직접 기록 |

### 데이터 플로우

모든 노드는 공유 `memory` 버스를 통해 데이터를 주고받는다:

```
[HTTP-1] → memory["http-1"] = { status, body }
    ↓
[IF-1]   → memory["http-1"].status === 200 ?
    ↓ TRUE             ↓ FALSE
[Code-1]           [Set-1] → memory["error"] = "failed"
    ↓
[Phase-1] → memory["code-1"].result 참조
```

- 템플릿 변수: `{{memory.nodeId.field}}` 패턴으로 값 참조
- IF 분기: 비활성 분기의 다운스트림 노드는 `skipped` 상태로 처리
- Merge: `depends_on`에 명시된 노드가 completed 또는 skipped이면 통과

### 노드 단독 실행

모든 노드에 ▶ 버튼 제공:
- **클릭** → `POST /api/workflows/nodes/run` (실제 실행)
- **Shift+클릭** → `POST /api/workflows/nodes/test` (Dry-run 미리보기)

| 모드 | Phase 노드 | 오케스트레이션 노드 |
|------|-----------|-------------------|
| Run | LLM 호출 → 결과 반환 | 실제 실행 (HTTP/Code/IF/Merge/Set) |
| Test | 프롬프트 미리보기 | 설정 검증 + 해석 결과 |

### 타입 시스템

- `WorkflowNodeDefinition` = `PhaseNodeDefinition | OrcheNodeDefinition`
- `normalize_workflow()`: 레거시 `phases[]` → 통합 `nodes[]` 변환
- `OrcheNodeState`: 런타임 상태 추적 (pending/running/completed/failed/skipped)

### 관련 파일

| 파일 | 역할 |
|------|------|
| `src/agent/workflow-node.types.ts` | 노드 유니온 타입, normalize |
| `src/agent/orche-node-executor.ts` | 5개 실행기 + resolve_templates |
| `src/agent/phase-loop-runner.ts` | 메인 루프 노드 분기 |
| `src/dashboard/routes/workflows.ts` | /nodes/run, /nodes/test API |
| `web/src/pages/workflows/graph-editor.tsx` | 노드 SVG 렌더링, ▶ 버튼 |

## 워크플로우 Resume (상태 영속성)

모든 상태 변경은 `store.upsert(state)`로 SQLite에 영속화. 이를 통해 크래시, 재시작, `waiting_user_input` 일시정지 후 **어느 지점에서든 재개** 가능.

### 영속화 대상

`PhaseLoopState`에 포함:
- `current_phase` — 상태 머신의 현재 Phase 인덱스
- `phases[].status` — 각 Phase의 현재 상태 (pending/running/completed/failed)
- `phases[].agents[].result` — 누적된 에이전트 결과
- `phases[].loop_iteration` / `loop_results` — 루프 모드 진행 상황
- `phases[].pending_user_input` — 사용자 입력 대기 여부
- `memory` — Phase 간 누적 데이터
- `definition` — 재실행을 위한 원본 워크플로우 정의

### Resume 흐름

```
1. DB에서 workflow_id로 PhaseLoopState 로드
2. status !== "completed"인 첫 번째 Phase 찾기
3. state.definition에서 PhaseLoopRunOptions 재구성
4. 기존 state를 주입하여 run_phase_loop() 호출
   → 상태 머신이 미완료 Phase부터 재개
```

### Resume 트리거

| 트리거 | 시나리오 |
|--------|----------|
| 사용자 응답 | `waiting_user_input` → 메시지 전송 → pending Promise resolve → 워크플로우 재개 |
| 서버 재시작 | 시작 시 `status: "running"` 워크플로우 탐색 → 각각 resume |
| 수동 재시도 | 대시보드 "Resume" 버튼 → 현재 Phase부터 `run_phase_loop()` 재호출 |

### 핵심 제약

러너는 **멱등성**을 보장: 완료된 Phase를 다시 실행해도 무시 (`while` 루프가 `status === "completed"` Phase를 스킵).

## 영향 파일

| 파일 | 변경 |
|------|------|
| `src/agent/phase-loop.types.ts` | mode/loop 필드, PhaseState 루프 상태, 새 이벤트, goto, depends_on, orche_states |
| `src/agent/phase-loop-runner.ts` | run_interactive_phase(), run_sequential_loop_phase(), 메인 루프 노드 분기, normalize_workflow 통합 |
| `src/agent/workflow-node.types.ts` | WorkflowNodeDefinition 유니온, normalize_workflow(), phase↔node 변환기 |
| `src/agent/orche-node-executor.ts` | HTTP/Code/IF/Merge/Set 실행기, resolve_templates, test_orche_node |
| `src/dashboard/ops-factory.ts` | ask_user 콜백, pending response 해소, run/test_single_node |
| `src/dashboard/routes/workflows.ts` | /api/workflows/nodes/run, /api/workflows/nodes/test 엔드포인트 |
| `src/dashboard/service.ts` | DashboardWorkflowOps: run_single_node, test_single_node 인터페이스 |
| `src/orchestration/workflow-loader.ts` | normalize에서 mode/loop 필드 파싱 |
| `web/src/pages/workflows/builder.tsx` | Phase mode 드롭다운, 오케 노드 편집 모달, 노드 실행 결과 모달, onRunNode |
| `web/src/pages/workflows/graph-editor.tsx` | 오케 노드 SVG 컴포넌트 (OrcheRectNode, IfDiamondNode, MergeDiamondNode), ▶ 버튼 |
| `web/src/i18n/ko.ts`, `en.ts` | 모드 + 오케스트레이션 노드 i18n 키 |

## 관련 문서

→ [Phase Loop](./phase-loop.md)
→ [Loop Continuity & HITL](./loop-continuity-hitl.md)
