# ARCHITECTURE

Project: `SoulFlow Orchestrator`

## 1. 목적
이 런타임은 채널 입력을 받아 Headless 에이전트 실행으로 처리하고, 상태를 파일 기반 메모리/세션/결정 저장소에 유지하는 오케스트레이터입니다.

## 2. 상위 구성
- Entry: `src/main.ts`
- Agent Domain: `src/agent/*`
- Channel Layer: `src/channels/*`
- Provider Layer: `src/providers/*`
- Scheduler: `src/cron/*`, `src/heartbeat/*`
- State Stores: `src/session/*`, `src/decision/*`, `src/agent/memory.service.ts`, `src/agent/task-store.ts`
- Runtime Bus: `src/bus/*`
- Ops/Dashboard: `src/ops/*`, `src/dashboard/*`

## 3. 부트 시퀀스
`createRuntime()`에서 다음을 초기화합니다.
1. `.env` 로드 (`src/utils/env.ts`)
2. 기본 템플릿/메모리 파일 보장 (`ensure_default_markdown_files`)
3. 핵심 서비스 생성:
   - `MessageBus`
   - `DecisionService`
   - `ProviderRegistry`
   - `AgentDomain`
   - `ChannelRegistry`, `ChannelManager`
   - `CronService`, `HeartbeatService`
   - `OpsRuntimeService`
   - `DashboardService`(옵션)
   - `Phi4RuntimeManager`(옵션)
4. 비동기 start:
   - `agent.start()`
   - `cron.start()`
   - `channel_manager.start()`
   - `ops.start()`
   - `dashboard.start()`
   - `phi4_runtime.start()`

## 4. 메시지 처리 플로우
1. Channel Poll
   - `ChannelManager.run_mention_loop()`가 채널별 `read()` 수행
2. Dedupe + Grouping
   - 중복 제거(`seen`)
   - 연속 메시지 그룹핑(`CHANNEL_GROUPING_*`)
3. Inbound Handling
   - 승인 응답 파싱
   - 중지 명령(`/stop`, `/cancel`, `/중지`) 처리
   - 읽음 반응/typing
   - 멘션 기반 서브 에이전트 호출 또는 일반 auto-reply
4. Headless Execution
   - `invoke_headless_agent()`에서 loop 모드 선택
   - `agent loop` 또는 `task loop` 실행
5. Outbound Delivery
   - `MessageBus` 또는 직접 `registry.send()`로 채널 전송
   - 스트리밍 chunk/진행 pulse/최종 결과 전송

## 5. 루프 모델
## Agent Loop
- 구현: `src/agent/loop.service.ts#run_agent_loop`
- 목적: 단일 요청을 max turns 내 완료
- 종료 조건:
  - `check_should_continue=false`
  - `max_turns` 도달
  - 오류

## Task Loop
- 구현: `src/agent/loop.service.ts#run_task_loop`
- 목적: 단계 노드(TaskNode) 순차 실행 및 재개
- 상태:
  - `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `max_turns_reached`
- 저장:
  - `TaskStore` (`runtime/tasks/store.json`)

## 6. 컨텍스트/메모리
## ContextBuilder (`src/agent/context.service.ts`)
- 입력:
  - bootstrap templates (`templates/*.md`)
  - memory (`memory/MEMORY.md`, `memory/yyyy-mm-dd.md`)
  - skills (`skills/`, `src/skills/`)
  - decisions (compact injection)
- 출력:
  - provider 호출용 `messages[]`

## MemoryStore (`src/agent/memory.service.ts`)
- 장기 메모리: `memory/MEMORY.md`
- 일일 메모리: `memory/yyyy-mm-dd.md`
- 검색/저장/압축(consolidate) 지원

## SessionStore (`src/session/service.ts`)
- 채널 대화 이력 JSONL 저장:
  - `runtime/sessions/*.jsonl`
- 최근 범위 조회 지원 (`N~M`)

## 7. Provider 구조
`ProviderRegistry`가 실행기를 라우팅합니다.
- `chatgpt`: `CliHeadlessProvider` (기본 `codex`)
- `claude_code`: `CliHeadlessProvider` (기본 `claude`)
- `openrouter`: HTTP Chat Completions
- `phi4_local`: 로컬 OpenAI 호환 엔드포인트

핵심 포인트:
- CLI provider는 stdin 기반 프롬프트 전달
- `on_stream`, `abort_signal` 지원
- 프로바이더 에러 문자열 표준화 후 상위 계층에서 처리

## 8. 채널 어댑터
- Slack: `src/channels/slack.channel.ts`
- Telegram: `src/channels/telegram.channel.ts`
- Discord: `src/channels/discord.channel.ts`

공통 베이스:
- `BaseChannel`
- `send`, `read`, `set_typing`, `parse_command`, `parse_agent_mentions`

## 9. Tools/승인
Tool Registry: `src/agent/tools/registry.ts`
- 기본 도구:
  - 파일/쉘/웹/메시지/파일요청/spawn/cron
- 백그라운드 실행:
  - 상태 추적 + 취소
- 승인 흐름:
  - `approval_required` 감지
  - 채널 승인 요청 발행
  - 이모지/텍스트 결정 파싱 후 실행

## 10. 스케줄러
## Cron
- `src/cron/service.ts`
- schedule 종류:
  - `at`, `every`, `cron`
- 저장:
  - `runtime/cron/cron-store.json`
- 등록 시 즉시 채널 등록 완료 메시지 발행(도구 컨텍스트가 있을 때)

## Heartbeat
- `src/heartbeat/service.ts`
- 주기적으로 `HEARTBEAT.md` 확인
- 비어있지 않으면 on_heartbeat 실행

## 11. Dashboard/Ops
Dashboard: `src/dashboard/service.ts`
- API:
  - `/api/state`
  - `/api/events` (SSE reload)
  - `/healthz`
- 정적 자산:
  - `dashboard/`

Ops: `src/ops/service.ts`
- health tick
- watchdog
- bridge pump(옵션)
- decision dedupe tick

## 12. 데이터 저장소
- `memory/`
  - `MEMORY.md`
  - `yyyy-mm-dd.md`
- `runtime/sessions/*.jsonl`
- `runtime/tasks/store.json`
- `runtime/decisions/index.json`
- `runtime/cron/cron-store.json`

## 13. 확장 포인트
- 새 채널 추가:
  - `BaseChannel` 구현 후 `create_channels_from_config` 등록
- 새 provider 추가:
  - `LlmProvider` 구현 후 `ProviderRegistry` 등록
- 새 tool 추가:
  - `Tool` 구현 후 `create_default_tool_registry` 등록
- 동적 tool:
  - `runtime-loader`, `installer`로 런타임 반영

## 14. 실패/복구 원칙
- 모든 런타임 루프는 비동기/논블로킹
- graceful shutdown 지원 (`SIGINT`, `SIGTERM`)
- 작업 실패 시 원인 코드 노출 후 재시도 가능 상태 유지
- 세션/태스크/결정/메모리는 파일 기반으로 재시작 복구 가능
