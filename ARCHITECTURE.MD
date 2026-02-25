# ARCHITECTURE

Project: `SoulFlow Orchestrator`

## 1. 목적
채널 메시지를 비동기 오케스트레이션 파이프라인으로 처리하고, 실행 상태를 파일 기반 저장소에 유지해 재시작 후에도 복구 가능한 런타임을 제공합니다.

핵심 원칙:
- 논블로킹 루프 유지
- 실패 시 재시도 + DLQ
- 컨텍스트는 파일 기반 메모리/세션/결정/이벤트에서 재구성

## 2. 상위 컴포넌트
- Entry: `src/main.ts`
- Agent Domain: `src/agent/*`
- Channel Layer: `src/channels/*`
- Provider Layer: `src/providers/*`
- Runtime Bus: `src/bus/*`
- Workflow Events: `src/events/*`
- Decision/Session Store: `src/decision/*`, `src/session/*`
- Scheduler: `src/cron/*`, `src/heartbeat/*`
- Ops/Dashboard: `src/ops/*`, `src/dashboard/*`

## 3. 부트 시퀀스
`createRuntime()` 초기화 순서:
1. `.env` 로드 (`src/utils/env.ts`)
2. 기본 템플릿/메모리 파일 보장 (`ensure_default_markdown_files`)
3. 핵심 서비스 생성:
   - `MessageBus`
   - `DecisionService`
   - `WorkflowEventService`
   - `ProviderRegistry`
   - `AgentDomain`
   - `ChannelRegistry`, `ChannelManager`
   - `CronService`, `HeartbeatService`
   - `OpsRuntimeService`, `DashboardService`
   - `Phi4RuntimeManager` (옵션)
4. 바인딩:
   - `events.bind_task_store(agent.task_store)`
5. start:
   - `agent.start()` -> `cron.start()` -> `channel_manager.start()` -> `ops.start()` -> `dashboard.start()`

## 4. 인바운드 파이프라인
구현 중심: `src/channels/manager.ts`

1. Polling
- `run_mention_loop()`가 채널별 `read()` 수행

2. 중복 제거/그룹핑
- `seen` 기반 dedupe
- `CHANNEL_GROUPING_*` 기반 묶음 처리

3. 반응 제어(리액션)
- Slack 메시지의 reaction을 읽어:
  - 승인 요청 자동 승인/거부/보류/취소
  - stop 리액션으로 active run 중지

4. Inbound 처리
- 승인 텍스트 응답 처리
- `/stop|/cancel|/중지`, `/help`, `/render`, `/secret`, `/cron` 공통 명령 처리
- read-ack reaction + typing 갱신
- 에이전트 멘션 처리 또는 plain auto reply

5. 민감정보 선차단 (오케스트레이터 레벨)
- 채널 수신 텍스트/스레드 문맥/미디어 경로에 대해 즉시 sealing 수행:
  - `seal_inbound_sensitive_text` (`src/security/inbound-seal.ts`)
  - 키 규칙: `inbound.<provider>.c<chatHash>.<type>.v<valueHash>`
- Secret reference/ciphertext 무결성 검사:
  - `inspect_secret_references_for_orchestration`
  - missing key / invalid ciphertext 발견 시 에이전트 실행 없이 `secret_resolution_required` 템플릿 응답

6. 컨텍스트 구성
- 세션 history + 첨부 파일 + thread nearby context 결합
- `ContextBuilder`로 시스템 프롬프트 생성 후 provider 실행

## 5. 실행 모델
### Agent Loop
- 구현: `src/agent/loop.service.ts` (`run_agent_loop`)
- 목적: 단일 목표를 턴 제한 내 연속 해결
- 종료 조건:
  - `check_should_continue=false`
  - `max_turns` 도달
  - abort/error

### Task Loop
- 구현: `src/agent/loop.service.ts` (`run_task_loop`)
- 목적: 단계 노드(TaskNode) 순차 실행/재개/승인 대기
- 상태:
  - `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `max_turns_reached`
- 저장소:
  - `TaskStore` (`runtime/tasks/store.json`)

## 6. 아웃바운드 파이프라인
### 공통 전송
- `ChannelRegistry.send()` 인라인 재시도
- `ChannelManager.dispatch_outbound()` 재큐잉(backoff)
- 최대 재시도 초과 시 DLQ 기록
  - `runtime/dlq/outbound.jsonl`

### 채널별 장문 처리
- Slack (`src/channels/slack.channel.ts`)
  - 분할 전송 + 길이 임계 초과 시 txt 첨부 폴백
- Telegram (`src/channels/telegram.channel.ts`)
  - 분할 전송 + 길이 임계 초과 시 txt 첨부 폴백

## 7. 컨텍스트/메모리/세션
### ContextBuilder
- 구현: `src/agent/context.service.ts`
- export alias: `src/agent/context.ts`
- 입력:
  - `templates/*.md`, `agents/*.md`
  - `memory/MEMORY.md`, `memory/yyyy-mm-dd.md`
  - Skills + compact decisions
- 출력:
  - provider용 `messages[]`

### MemoryStore
- 구현: `src/agent/memory.service.ts`
- export alias: `src/agent/memory.ts`
- 기능:
  - longterm/daily read-write
  - 검색
  - consolidate (`consolidate`, `consolidate_with_provider`)

### SessionStore
- 구현: `src/session/service.ts`
- 저장:
  - `runtime/sessions/*.jsonl`
- 기능:
  - 최근 N개
  - N~M 범위 조회

## 8. Workflow Events + Task 동기화
- 구현: `src/events/service.ts`
- 저장:
  - `runtime/events/events.jsonl`
  - `runtime/events/index.json`
  - `runtime/tasks/details/<task_id>.md`
- 이벤트 append 시:
  - dedupe
  - detail append
  - `TaskStore` 상태 자동 동기화 (`bind_task_store` 기반)

## 9. Tools 및 승인 흐름
- Registry: `src/agent/tools/registry.ts`
- 기본 툴: 파일/쉘/웹/메시지/파일요청/spawn/cron + 동적 툴
- `diagram_render` 툴: Mermaid -> SVG/ASCII 렌더 (`src/agent/tools/diagram.ts`)
- 승인 흐름:
  - 툴이 `approval_required` 반환
  - approval request 발행
  - 텍스트 또는 reaction으로 결정
  - 승인 시 재실행

### Tool 레벨 비밀값 해석
- 모든 Tool 실행은 `Tool.execute` 공통 경로에서 secret 해석 수행 (`src/agent/tools/base.ts`)
- `resolve_inline_secrets_with_report` 결과에 따라:
  - 정상: 도구 내부 실행
  - 실패: `Error: secret_resolution_required` 템플릿 반환 (복호화 금지)

## 10. Provider 구조
`ProviderRegistry` 라우팅 대상:
- `chatgpt`: CLI headless (`codex exec`)
- `claude_code`: CLI headless (`claude -p`)
- `openrouter`: HTTP chat completions
- `phi4_local`: local OpenAI-compatible endpoint

공통 기능:
- stream callback
- abort signal
- 오류 문자열 표준화

## 11. Channel Adapter 구조
- Slack: `src/channels/slack.channel.ts`
- Telegram: `src/channels/telegram.channel.ts`
- Discord: `src/channels/discord.channel.ts`
- Base: `src/channels/base.ts`

공통 인터페이스:
- `send`, `read`, `set_typing`, `parse_command`, `parse_agent_mentions`

## 12. Scheduler
### Cron
- 구현: `src/cron/service.ts`
- schedule type: `at`, `every`, `cron`
- 저장: `runtime/cron/cron-store.json`

### Heartbeat
- 구현: `src/heartbeat/service.ts`
- `HEARTBEAT.md` 기반 주기 실행

## 13. Dashboard/Ops
### Dashboard (`src/dashboard/service.ts`)
- API: `/api/state`, `/api/events`, `/healthz`
- state 구성 시 `loop task + task_store`를 병합해 표시

### Ops (`src/ops/service.ts`)
- health tick
- watchdog
- decision dedupe

## 14. 데이터 저장소 맵
- `memory/`
  - `MEMORY.md`
  - `yyyy-mm-dd.md`
- `runtime/security/`
  - `master.key`
  - `secrets.json`
- `runtime/sessions/*.jsonl`
- `runtime/tasks/store.json`
- `runtime/tasks/details/*.md`
- `runtime/events/events.jsonl`
- `runtime/events/index.json`
- `runtime/decisions/index.json`
- `runtime/cron/cron-store.json`
- `runtime/dlq/outbound.jsonl`
- `runtime/inbound-files/*`

## 16. 채널 파일 입출력 경로
- 수신 첨부/파일 URL은 `runtime/inbound-files/<provider>/`에 저장
- 저장된 로컬 파일 경로만 분석 컨텍스트에 주입
- 원격 URL은 직접 media attach 하지 않고 다운로드 후 로컬 경로로 표준화

## 17. 다이어그램 (diagram tool 생성물)
- `docs/diagrams/orchestrator-flow.svg`
- `docs/diagrams/sensitive-seal-flow.svg`

## 15. 실패/복구 전략
- 루프는 기본 논블로킹
- graceful shutdown (`SIGINT`, `SIGTERM`)
- 전송 실패는 재시도 후 DLQ로 보존
- 메모리/세션/이벤트/태스크 상태는 파일 기반 복구 가능
