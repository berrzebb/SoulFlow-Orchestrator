# 설계: 인터랙션 노드 & 런너 레벨 실행

> **Status**: 구현 완료 · 10개 신규 노드 타입 · 런너 특수 노드 디스패치

## 개요

워크플로우 엔진에 **10개 새 오케스트레이션 노드**를 추가합니다. 이 노드들은 채널 통신, 재시도 루프, 배치 실행, 도구 호출 등 런너 레벨 컨텍스트가 필요하여 기존 `execute_orche_node` 디스패처만으로는 처리할 수 없습니다.

## 문제

기존 `execute_orche_node` 경로는 `OrcheNodeExecutorContext` (memory + abort_signal + workspace)만 제공하므로 다음이 불가능:
- 채널 송수신 (HITL, Approval, Form, Notify, Escalation, SendFile)
- 백오프 재시도 오케스트레이션 (Retry)
- 병렬 하위 실행 (Batch)
- 도구 레지스트리 접근 (Tool Invoke)
- 다중 소스 정족수 평가 (Gate)

## 아키텍처

### 실행 흐름

```
phase-loop-runner: orche 노드 블록
  │
  ├── execute_special_node(node, state, options, deps)
  │     ├── hitl       → ask_channel(prompt, timeout) → ChannelResponse
  │     ├── approval   → ask_channel(structured:approval) → votes, approved
  │     ├── form       → ask_channel(structured:form) → fields
  │     ├── notify     → send_message(content) → ok, message_id
  │     ├── send_file  → send_message([file:path]) → ok
  │     ├── escalation → 조건 평가 → 충족 시 send_message
  │     ├── retry      → 루프: execute_orche_node(target) + backoff
  │     ├── batch      → 병렬: execute_orche_node(body) per item
  │     ├── tool_invoke→ invoke_tool(tool_id, params) → result
  │     └── default    → null (기본 executor로 폴백)
  │
  └── execute_orche_node(node, ctx) ← 나머지 노드용 기본 경로
```

### 콜백 프로토콜

`PhaseLoopRunOptions`에 3개 선택적 콜백:

| 콜백 | 패턴 | 사용 노드 |
|------|------|----------|
| `send_message` | fire-and-forget | Notify, SendFile, Escalation |
| `ask_channel` | 전송 + 응답 대기 | HITL, Approval, Form |
| `invoke_tool` | tool_id + params → string | Tool Invoke |

모든 콜백은 선택적 — 미제공 시 graceful degradation (경고 로그 + 기본값 반환).

### 채널 통신 타입

```typescript
interface ChannelSendRequest {
  target: "origin" | "specified";  // origin: 트리거 채널, specified: 지정 채널
  channel?: string;
  chat_id?: string;
  content: string;
  structured?: { type: "approval" | "form"; payload: Record<string, unknown> };
  parse_mode?: string;
}

interface ChannelResponse {
  response: string;
  responded_by?: { user_id?: string; username?: string; channel?: string };
  responded_at: string;
  timed_out: boolean;
  approved?: boolean;       // Approval 전용
  comment?: string;         // Approval 전용
  votes?: Array<...>;       // Approval (다중 승인자)
  fields?: Record<...>;     // Form 전용
}
```

## 노드 카탈로그

### Interaction 카테고리 (채널 바인딩)

| 노드 | 형태 | 목적 | 런너 로직 |
|------|------|------|----------|
| HITL | rect | 자유 텍스트 Q&A | ask_channel → response |
| Approval | rect | 이진 승인/거절 + 정족수 | ask_channel(structured:approval) → approved, votes |
| Form | rect | 스키마 기반 구조화 입력 | ask_channel(structured:form) → fields |
| Escalation | rect | 조건부 상위 채널 알림 | evaluate_condition → send_message |

### Flow 카테고리 (실행 제어)

| 노드 | 형태 | 목적 | 런너 로직 |
|------|------|------|----------|
| Gate | diamond | K-of-N 정족수 체크 | 핸들러 단독 (memory 체크) |
| Retry | rect | 실패 노드 재실행 | 백오프 전략 루프 |
| Batch | rect | 병렬 배열 처리 | 동시성 제한 병렬 실행 |
| Assert | diamond | 데이터 검증 체크포인트 | 핸들러 단독 (평가 + throw) |

### Advanced 카테고리

| 노드 | 형태 | 목적 | 런너 로직 |
|------|------|------|----------|
| Tool Invoke | rect | 동적 도구 실행 | invoke_tool 콜백 |
| Cache | rect | TTL 기반 키-값 캐시 | 핸들러 단독 (인메모리 저장소) |

## SSE 이벤트

```typescript
| { type: "node_waiting"; node_id; node_type; reason }   // HITL/Approval/Form 대기
| { type: "node_retry"; node_id; attempt; max_attempts; error }  // Retry 백오프
```

## 에스컬레이션 조건 평가

```
always        → 항상 에스컬레이션
on_timeout    → depends_on 노드 중 timed_out=true 존재
on_rejection  → depends_on 노드 중 approved=false 존재
custom        → memory 컨텍스트에서 custom_expression 평가
```

## Retry 백오프 전략

| 전략 | 공식 |
|------|------|
| exponential | `initial * 2^(attempt-1)` |
| linear | `initial * attempt` |
| fixed | `initial` |

모두 `max_delay_ms`로 상한 제한.

## Batch 실행

1. `memory[array_field]`에서 배열 추출
2. `concurrency` (기본 5) 단위로 청크 처리
3. 각 아이템: `memory._batch_item` + `_batch_index`로 주입
4. `body_node`를 `execute_orche_node`로 아이템별 실행
5. 결과 수집, succeeded/failed 카운트
6. `on_item_error: "halt"` → 첫 실패 시 중단

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/agent/nodes/{hitl,approval,form,tool-invoke,gate,escalation,cache,retry,batch,assert}.ts` | 신규 핸들러 10개 |
| `src/agent/nodes/index.ts` | 10개 핸들러 등록 |
| `src/agent/workflow-node.types.ts` | 10개 타입 정의 + OrcheNodeType/OrcheNodeDefinition 유니온 |
| `src/agent/phase-loop.types.ts` | ChannelSendRequest, ChannelResponse, RunOptions 콜백, SSE 이벤트 |
| `src/agent/phase-loop-runner.ts` | execute_special_node 디스패치 + 9개 핸들러 함수 |
| `web/src/pages/workflows/nodes/*.tsx` | 프론트엔드 descriptor 10개 |
| `web/src/pages/workflows/nodes/index.ts` | 10개 descriptor 등록 + 카테고리 맵 |
| `web/src/pages/workflows/node-registry.ts` | interaction 카테고리 |
| `web/src/i18n/{ko,en}.ts` | ~80개 i18n 키 |
