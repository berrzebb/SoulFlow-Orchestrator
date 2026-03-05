# 설계: 에이전트 루프 연속성 + Task HITL

> **상태**: 구현 완료

## 문제

### 1. 에이전트 루프 조기 종료

에이전트 루프가 작업 완료 여부와 관계없이 1턴 후 종료.

**원인 A — `check_should_continue` 하드코딩:**

```typescript
// src/orchestration/service.ts:508
check_should_continue: async ({ state }) => {
  if (state.currentTurn > 1) return false;  // 1턴 후 무조건 종료
  return AGENT_TOOL_NUDGE;
},
```

**원인 B — ContainerCliAgent가 CLI `complete` 후 즉시 종료:**

```typescript
// src/agent/pty/container-cli-agent.ts:151-164
if (result.type === "complete") {
  const followups = this.bus.lane_queue.drain_followups(session_key);
  if (followups.length > 0) { continue; }      // 사전 큐잉된 것만 처리
  const collected = this.bus.lane_queue.drain_collected(session_key);
  if (collected) { continue; }                  // 사전 수집된 것만 처리
  return this.build_result(last_content, "stop", ...);  // 대기 메커니즘 없음
}
```

**기대 동작:** 다음 조건에서만 루프 종료:
- 작업 완료 (에이전트가 "완료" 신호)
- Max turns 도달
- HITL 조건 미충족
- Abort 시그널

### 2. Task HITL 미연결

Task 모드에 mailbox 주입(`loop.service.ts:inject_message`)과 resume 서비스(`task-resume.service.ts`)가 존재하지만:

- ContainerCliAgent의 PTY 루프가 `inject_message` mailbox와 **연결되지 않음**
- `register_send_input` 콜백이 followup 큐에 넣지만, 루프가 이미 `complete` 후 종료됨
- 사용자 메시지 도착 → task resume 시도 → 루프 이미 종료 → 주입 실패

**기대 동작:** Task 실행 중 사용자 메시지를 HITL로 주입 가능 (승인, 방향 전환, 추가 입력).

---

## 아키텍처 갭

```
현재:
  사용자 메시지 → TaskResumeService → inject_message(loop_id) → mailbox
                                                                    ↓
  ContainerCliAgent.run() → while 루프 → complete → [연결 없음] → 종료

기대:
  사용자 메시지 → TaskResumeService → inject_message(loop_id) → mailbox
                                                                    ↓
  ContainerCliAgent.run() → while 루프 → complete → 입력 대기 → 계속
                                                        ↑
                                                mailbox → followup 큐 브리지
```

---

## 해결 방안

### 방안 A: 최소 수정 (기존 아키텍처 내)

1. **`check_should_continue`**: 하드코딩 대신 실제 완료 감지
2. **ContainerCliAgent 대기**: `complete` 후 followup 주입 대기
3. **Mailbox → followup 브리지**: `loop.service.inject_message` → `bus.queue_followup` 연결

### 방안 B: 아키텍처 정비

1. **task/agent 루프 통합**: 두 모드 모두 TaskNode 워크플로 사용
2. **PTY를 순수 실행기로**: ContainerCliAgent는 TaskNode 내 실행기 역할만
3. **HITL을 TaskNode 상태로**: `waiting_user_input` 상태에서 실행 일시정지, 입력 시 재개

### 방안 C: 이벤트 기반 연속

1. **완료 평가기**: `complete` 후 원본 태스크 충족 여부 검사
2. **자동 계속**: 미충족 시 continuation 프롬프트 생성 → 루프 재투입
3. **HITL 이벤트**: 모든 실행 모드에서 사용자 입력 주입 이벤트 버스 노출

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/orchestration/service.ts` | `check_should_continue`, `run_agent_loop`, `run_task_loop` |
| `src/agent/pty/container-cli-agent.ts` | PTY 실행 루프, followup drain |
| `src/agent/loop.service.ts` | Task 루프, mailbox 주입 |
| `src/channels/task-resume.service.ts` | HITL resume 플로우 |
| `src/channels/manager.ts` | active run 관리, 메시지 라우팅 |
| `src/agent/pty/lane-queue.ts` | followup/collect 큐 |

## 관련 문서

→ [PTY 에이전트 백엔드](./pty-agent-backend.md) — 컨테이너 실행 아키텍처
→ [Phase Loop 설계](./phase-loop.md) — TaskNode 워크플로
