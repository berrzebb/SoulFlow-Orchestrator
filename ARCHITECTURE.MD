# ARCHITECTURE

Project: `SoulFlow Orchestrator`

## 1. 목적

채널 메시지를 비동기 오케스트레이션 파이프라인으로 처리하고, 실행 상태를 SQLite 중심 저장소에 유지해 재시작 후에도 복구 가능한 런타임을 제공합니다.

핵심 원칙:
- 논블로킹 루프 유지
- 실패 시 재시도 + DLQ
- 컨텍스트는 파일 기반 메모리/세션/결정/이벤트에서 재구성
- 서비스 간 비동기 디커플링 (MessageBus)

## 2. 상위 컴포넌트

| 모듈 | 디렉터리 | 역할 |
|------|----------|------|
| Entry | `src/main.ts` | 부트스트랩, 서비스 조립, graceful shutdown |
| Agent Domain | `src/agent/` | 에이전트 런타임, 루프, 도구, 스킬, 메모리 |
| Agent Backends | `src/agent/backends/` | 4개 백엔드 통합 (CLI 래퍼 + 네이티브 SDK) |
| Channel Layer | `src/channels/` | 매니저, 디스패치, 승인, 미디어, 세션 기록, 커맨드 |
| Orchestration | `src/orchestration/` | once/agent/task 실행 모드 선택 및 실행 |
| Provider Layer | `src/providers/` | LLM 프로바이더, Circuit Breaker, Health Scorer |
| Runtime Bus | `src/bus/` | 비동기 메시지 큐 (inbound/outbound/progress) |
| MCP | `src/mcp/` | MCP 서버 연결, 도구 등록 |
| Workflow Events | `src/events/` | 이벤트 기록 + TaskStore 동기화 |
| Decision/Session | `src/decision/`, `src/session/` | 결정사항·세션 저장소 |
| Security | `src/security/` | Secret Vault, 인바운드 seal, 감사 로그 |
| Scheduler | `src/cron/`, `src/heartbeat/` | 크론, 하트비트 |
| Ops/Dashboard | `src/ops/`, `src/dashboard/` | 운영 서비스, 웹 대시보드 (인라인 자산) |
| Runtime | `src/runtime/` | ServiceManager, 인스턴스 락 |
| Config | `src/config/` | Zod 기반 설정 스키마 + env 파싱 |
| Skills | `src/skills/` | 역할 기반 스킬 시스템 (8개 역할 + 공유 프로토콜) |
| Utilities | `src/utils/` | SQLite 헬퍼, env 로더, 공용 함수 |

## 3. ServiceManager 라이프사이클

`ServiceManager` (`src/runtime/service-manager.ts`)가 모든 서비스의 생명주기를 관리합니다.

```
ServiceLike 인터페이스:
  name: string
  start(): Promise<void>
  stop(): Promise<void>
  health_check(): { ok: boolean; detail?: string }
```

- `register(service, { required? })` — 서비스 등록 (required 실패 시 부트 중단)
- `start()` — 등록 순서대로 시작
- `stop()` — 역순 정지
- `health_check()` — 전체 서비스 건강 상태 집계

## 4. 부트 시퀀스

`createRuntime()` (`src/main.ts`) 초기화 순서:

1. `.env` 로드 (`src/utils/env.ts`)
2. 단일 인스턴스 락 획득 (`src/runtime/instance-lock.ts`)
3. `load_config_from_env()` → `AppConfig`
4. 핵심 서비스 생성:
   - `MessageBus`
   - `DecisionService`, `WorkflowEventService`
   - `ProviderRegistry` (+ CircuitBreaker, HealthScorer)
   - 에이전트 백엔드 조립:
     - `CliAgent("claude_cli")`, `CliAgent("codex_cli")` (항상 생성)
     - `ClaudeSdkAgent` (SDK 사용 가능 시 추가)
     - `CodexAppServerAgent` (AppServer 사용 가능 시 추가)
   - `AgentSessionStore` (세션 영속화)
   - `AgentBackendRegistry` (CircuitBreaker + fallback + 세션 관리)
   - `AgentDomain` (tools, skills, memory, tasks, subagents)
   - `SessionStore`
   - `CronService`
   - `ChannelRegistry` (채널 어댑터 등록)
   - `DispatchService` (retry + DLQ + dedup + rate limiter)
   - `SessionRecorder`, `MediaCollector`
   - `ApprovalService`
   - `McpClientManager` → MCP 도구 자동 등록
   - `ProcessTracker`
   - `OrchestrationService`
   - `CommandRouter` (16개 슬래시 커맨드)
   - `TaskResumeService`
   - `ChannelManager`
5. 선택 서비스 생성:
   - `Phi4RuntimeManager`
   - `HeartbeatService`, `OpsRuntimeService`, `DashboardService`
6. 내장 도구 등록 (cron, memory, decision, secret, promise)
7. `ServiceManager`에 전체 서비스 등록 (required/optional 구분)
8. `ServiceManager.start()` → 순차 기동
9. `RuntimeApp` 인터페이스 반환

Graceful Shutdown (`SIGINT`/`SIGTERM`):
→ `ServiceManager.stop()` → `MessageBus.close()` → `SessionStore.close()` → 인스턴스 락 해제

## 5. 인바운드 파이프라인

![Inbound Pipeline](docs/diagrams/inbound-pipeline.svg)

```
Channel.read() → Dedup → Bus.publish_inbound → Bus.consume_inbound
  → CommandRouter (슬래시 커맨드 처리)
  → ApprovalService (승인 텍스트/리액션)
  → Sensitive Seal (민감정보 치환)
  → MediaCollector (첨부 다운로드)
  → OrchestrationService (AI 실행)
  → SessionRecorder (히스토리 저장)
  → DispatchService (응답 전송)
```

### 5.1 Polling

`ChannelManager.run_poll_loop()`가 채널별 `read()` 수행.
수신 메시지는 seen 기반 dedup 후 `Bus.publish_inbound()`.

### 5.2 커맨드 라우팅

`CommandRouter` (`src/channels/commands/router.ts`)가 16개 슬래시 커맨드를 라우팅:
`/help`, `/stop`, `/render`, `/secret`, `/memory`, `/decision`, `/promise`, `/cron`, `/reload`, `/task`, `/status`, `/skill`, `/doctor`, `/agent`, `/stats`, `/verify`

오타 자동 보정: Levenshtein 거리 ≤ 2 이내 퍼지 매칭.

### 5.3 승인 처리

`ApprovalService` (`src/channels/approval.service.ts`):
- 텍스트 응답에서 request_id 매칭 → approve/deny
- Slack 리액션 이모지 → 승인/거부/보류/취소 매핑
- stop 리액션 → 활성 실행 중지 + 서브에이전트 cascade cancel

### 5.4 민감정보 선차단

채널 수신 직후 `seal_inbound_sensitive_text` (`src/security/inbound-seal.ts`):
- 키 규칙: `inbound.<provider>.c<chatHash>.<type>.v<valueHash>`
- Secret reference/ciphertext 무결성 검사 (`inspect_secret_references_for_orchestration`)
- 키 미식별 / 암호문 무효 시 에이전트 실행 없이 `secret_resolution_required` 응답

### 5.5 미디어 수집

`MediaCollector` (`src/channels/media-collector.ts`):
- 채널 메타데이터 파일 (Slack files, Telegram, Discord)
- 인라인 URL 링크
- 로컬 파일 참조
→ `runtime/inbound-files/<provider>/`에 저장, 로컬 경로만 분석 컨텍스트에 주입

## 6. 실행 모델

`OrchestrationService` (`src/orchestration/service.ts`)가 실행 모드를 결정합니다:

| 모드 | 구현 | 용도 |
|------|------|------|
| `once` | 단일 턴 응답 | 간단한 질의응답 |
| `agent` | `run_agent_loop` | 다중 턴 연속 목표 해결 |
| `task` | `run_task_loop` | 단계 노드 순차 실행/재개/승인 대기 |

실행 흐름:
1. 민감정보 seal
2. 스킬 해석 (always + request-triggered)
3. Secret 무결성 검사
4. 런타임 정책 결정 (커맨드 프로파일 기반)
5. 도구 컨텍스트 + 세션 히스토리 조립
6. 실행 모드 선택 → 에이전트 백엔드 실행
7. StreamBuffer를 통한 점진적 출력

### Agent Loop

`src/agent/loop.service.ts` (`run_agent_loop`):
- 단일 목표를 턴 제한 내 연속 해결
- 종료: `check_should_continue=false`, `max_turns` 도달, abort/error

### Task Loop

`src/agent/loop.service.ts` (`run_task_loop`):
- TaskNode 순차 실행/재개/승인 대기
- 상태: `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `max_turns_reached`
- 저장소: `TaskStore` (`runtime/tasks/tasks.db`)

## 7. 에이전트 백엔드 추상화

![Service Architecture](docs/diagrams/service-architecture.svg)

`AgentBackendRegistry` (`src/agent/agent-registry.ts`)가 4개 백엔드를 통합 관리합니다:

| 백엔드 | 구현 | 특성 |
|--------|------|------|
| `claude_cli` | `CliAgent` | Claude CLI 래퍼, 내부 tool loop |
| `codex_cli` | `CliAgent` | Codex CLI 래퍼, 내부 tool loop |
| `claude_sdk` | `ClaudeSdkAgent` | @anthropic-ai/claude-code SDK 네이티브, resume 지원 |
| `codex_appserver` | `CodexAppServerAgent` | Codex JSON-RPC AppServer 모드, resume 지원 |

### Fallback 체인

동일 계열 자동 fallback:
```
claude_sdk  ──실패──▶ claude_cli
codex_appserver ──실패──▶ codex_cli
```

Fallback 트리거: 백엔드 미사용 가능, CircuitBreaker open, 실행 에러.

### AgentSessionStore

`src/agent/agent-session-store.ts`:
- SQLite 기반 세션 영속화 (`runtime/agent-sessions.db`)
- TTL 기반 만료 (기본 24시간)
- 성공 실행 시 자동 저장, `task_id` 기반 조회
- resume 지원 백엔드(SDK/AppServer)에서 활용

## 8. 프로바이더 복원력

![Provider Resilience](docs/diagrams/provider-resilience.svg)

### ProviderRegistry

`src/providers/service.ts` — LLM 프로바이더 관리:

| 프로바이더 | 구현 | 프로토콜 |
|-----------|------|----------|
| `chatgpt` | CliHeadlessProvider | Codex CLI |
| `claude_code` | CliHeadlessProvider | Claude CLI |
| `openrouter` | OpenRouterProvider | HTTP API |
| `phi4_local` | Phi4LocalProvider | Local endpoint |

### CircuitBreaker

`src/providers/circuit-breaker.ts` — 프로바이더/백엔드별 장애 차단:

```
closed (정상)  ──N회 실패──▶  open (차단)
                               │
                          timeout 경과
                               │
                               ▼
                         half_open (제한적)
                           │         │
                        성공→closed  실패→open
```

- `can_acquire()` — 상태 확인 (비소모)
- `try_acquire()` — 슬롯 소모 (half_open 시 제한)
- 기본: failure_threshold=5, reset_timeout=30s

### HealthScorer

`src/providers/health-scorer.ts`:
- 슬라이딩 윈도우 (50 샘플) 기반 성공률·지연시간 수집
- `score = success_weight × success_rate + latency_weight × (1 - avg_latency / target)`
- `rank()` → 점수 기반 프로바이더 순위 → 자동 fallback 체인

## 9. 역할 기반 스킬 시스템

![Role Delegation](docs/diagrams/role-delegation.svg)

`src/skills/` — 역할 기반 서브에이전트 시스템.

### 역할 (8개)

| 역할 | 식별자 | 설명 |
|------|--------|------|
| butler | `role:butler` | 사용자 직접 대면, 비개발 작업 처리, 개발 감지 시 PM/PL에 위임 |
| pm | `role:pm` | 요구사항 분석, 스펙 작성, 우선순위 결정 |
| pl | `role:pl` | 실행 조율, 개발팀 spawn, Phase Gate 판정 |
| generalist | `role:generalist` | 범용 서브에이전트, 전문 역할 불필요한 단일 작업 |
| implementer | `role:implementer` | 코드 구현 전문, 스펙 기반 파일 수정 + 셀프 검증 |
| reviewer | `role:reviewer` | 코드 리뷰 전문, 품질·보안·성능·컨벤션 검토 |
| debugger | `role:debugger` | 디버깅 전문, 버그 추적, 근본 원인 분석(RCA) |
| validator | `role:validator` | 검증 전문, 빌드·테스트·lint 실행 및 결과 판정 |

### 위임 계층

```
butler (사용자 대면)
  ├── pm (기획 필요)
  │     └── pl (실행 위임)
  └── pl (즉시 실행)
        ├── implementer (구현)
        ├── reviewer (리뷰)
        ├── validator (검증)
        ├── debugger (디버깅)
        └── generalist (잡무)
```

### 공유 프로토콜 (`_shared/`)

| 프로토콜 | 용도 |
|----------|------|
| `clarification-protocol` | 불확실성 분류 및 질문 판단 기준 |
| `session-metrics` | 세션 메트릭 수집/보고 규칙 |
| `phase-gates` | 단계별 체크포인트 통과 기준 |
| `difficulty-guide` | 작업 난이도 분류 및 턴 예산 배정 |
| `error-escalation` | 에러 시 에스컬레이션 절차 |
| `lang/typescript` | TypeScript 코드 컨벤션 |
| `lang/rust` | Rust 코드 컨벤션 |

### CD Scoring

`src/agent/cd-scoring.ts` — Clarification Debt 관찰자:

| 지표 | 점수 | 트리거 |
|------|------|--------|
| `clarify` | +10 | `ask_user` 도구 호출 |
| `correct` | +25 | 연속 3회 이상 도구 에러 후 성공/전환 |
| `redo` | +40 | 롤백 에러 이벤트 |

## 10. 아웃바운드 파이프라인

`DispatchService` (`src/channels/dispatch.service.ts`)가 전송을 담당합니다:

```
OutboundMessage → Bus.publish_outbound
  → DispatchService.consume_loop()
    → OutboundDedupePolicy (중복 감지)
    → TokenBucketRateLimiter (API rate limit 보호)
    → ChannelRegistry.send() (인라인 재시도)
    → 실패 시 exponential backoff 재큐잉
    → 최대 재시도 초과 시 DLQ (runtime/dlq/dlq.db)
```

### TokenBucketRateLimiter

`src/channels/rate-limiter.ts`:
- 용량 30 토큰, 1토큰/초 보충 (기본값)
- `try_consume()` → 토큰 차감 시도
- `wait_time_ms()` → 다음 토큰까지 대기 시간

### OutboundDedupePolicy

`src/channels/outbound-dedupe.ts`:
- provider + chat + thread + kind + trigger 기반 복합 키
- `agent_reply`/`agent_error`는 source message 기준 1회 전송 보장
- TTL + maxSize 기반 캐시 정리

### 채널별 장문 처리

Slack/Telegram: 분할 전송 + 길이 임계 초과 시 txt 첨부 폴백

## 11. 컨텍스트/메모리/세션

### ContextBuilder

`src/agent/context.service.ts`:
- 입력: `templates/*.md`, `agents/*.md`, `memory.db`, skills, decisions, promises
- 역할 컨텍스트: 역할 본문 + 공유 프로토콜 자동 결합
- 모델 라우팅: `model:local` (직접 실행) / `model:remote` (spawn)
- 출력: provider용 `messages[]`

### ContextBudget

`src/agent/context-budget.ts`:
- 우선순위 기반 섹션 선택 (0=필수, 1~3=선택)
- 토큰 추정: 4 chars ≈ 1 token
- `fit(sections)` → max_tokens 내 섹션 선택

### PromptVersion

`src/agent/prompt-version.ts`:
- `SHA-256(prompt).slice(0,12)` 기반 버전 추적
- 프롬프트 끝에 `<!-- prompt_version: XX -->` 스탬프

### MemoryStore

`src/agent/memory.service.ts`:
- longterm/daily read-write, 검색
- `consolidate_with_provider` 기반 압축

### SessionStore

`src/session/service.ts`:
- 저장: `runtime/sessions/sessions.db`
- 최근 N개 / N~M 범위 조회

### SessionRecorder

`src/channels/session-recorder.ts`:
- (provider, chat_id, alias, thread_id) 기준 히스토리 저장
- 사용자/어시스턴트 턴 기록 + daily memory 추가

## 12. MCP 통합

`McpClientManager` (`src/mcp/client-manager.ts`):

- stdio/SSE 기반 MCP 서버 프로세스 관리
- 서버별 도구 자동 검색 (`listTools`) + 이름 → 서버 매핑
- `call_tool(name, args, { signal })` → 올바른 서버로 라우팅
- 개별 서버 장애가 전체를 차단하지 않음

CLI 프로바이더 MCP 주입:
- `with_codex_mcp_runtime_overrides` → Codex CLI에 MCP 서버 설정 전달
- 프로젝트별 MCP 도구 자동 등록 (`ORCH_MCP_ENABLE_ALL_PROJECT`)

## 13. Tools 및 승인 흐름

### 도구 레지스트리

`src/agent/tools/` — 기본 도구:
- 파일/쉘/웹/메시지/파일전송/spawn/cron
- 동적 도구 (`runtime/custom-tools/tools.db`)
- `diagram_render`: Mermaid → SVG/ASCII (`@vercel/beautiful-mermaid`)
- MCP 도구 (McpClientManager 경유)

### Tool 레벨 비밀값 해석

모든 도구 실행은 `Tool.execute` (`src/agent/tools/base.ts`)에서 secret 해석:
- `resolve_inline_secrets_with_report` 정상 → 도구 내부 실행
- 실패 → `secret_resolution_required` 템플릿 반환 (복호화 금지)

### 승인 흐름

1. 도구가 `approval_required` 반환
2. 승인 요청 발행 (채널 메시지)
3. 텍스트 또는 리액션으로 결정
4. 승인 시 재실행

## 14. 스트리밍 출력

### StreamBuffer

`src/channels/stream-buffer.ts`:
- 점진적 출력 버퍼링 + 주기적 플러시
- 중복/오버랩 감지 (최근 4000자 비교, 델타 추출)
- 플러시 조건: buffer ≥ min_chars AND elapsed ≥ interval_ms

### ContentRenderer

`src/channels/content-renderer.ts`:
- 블록 타입: text, code, table, image, chart, media
- 출력 포맷: markdown, plain text, HTML

### OutputSanitizer

`src/channels/output-sanitizer.ts`:
- 도구 프로토콜 누출 (tool_calls, tool_call_id) 필터링
- 프로바이더 노이즈/페르소나 누출/민감 커맨드 제거

## 15. Channel Adapter

| 채널 | 구현 | SDK |
|------|------|-----|
| Slack | `src/channels/slack.channel.ts` | `@slack/web-api` WebClient |
| Telegram | `src/channels/telegram.channel.ts` | HTTP API |
| Discord | `src/channels/discord.channel.ts` | HTTP API |
| Base | `src/channels/base.ts` | 추상 기반 클래스 |

공통 인터페이스: `send`, `read`, `set_typing`, `parse_command`, `parse_agent_mentions`

Slack: `WebClient` 인스턴스 기반 `auth.test()` 검증, `filesUploadV2` 파일 전송.

## 16. Scheduler

### Cron

`src/cron/service.ts`:
- 스케줄 타입: `at` (1회), `every` (반복), `cron` (cron 표현식)
- `at` 1회성은 실행 후 auto-remove (`delete_after_run=true`)
- 저장: `runtime/cron/cron.db`

### Heartbeat

`src/heartbeat/service.ts`:
- `HEARTBEAT.md` 기반 주기 실행

## 17. Dashboard/Ops

### Dashboard (`src/dashboard/service.ts`)

- 인라인 정적 자산 (`src/dashboard/assets.ts`): HTML/CSS/JS를 코드 내 템플릿 리터럴로 포함
- API: `/api/state`, `/api/events`, `/healthz`
- SSE 기반 실시간 업데이트 (에이전트 스트림, 이벤트 피드)
- 고정 포트 바인딩 (기본 4200)
  - `DASHBOARD_PORT_FALLBACK=1` 명시 설정 시에만 임시 포트 fallback 허용
  - 미설정 시 포트 충돌은 에러로 실패

### Ops (`src/ops/service.ts`)

- health tick, watchdog, decision dedupe

## 18. Workflow Events + Task 동기화

`src/events/service.ts`:
- 저장: `runtime/events/events.db`
- 이벤트 타입: `assign`, `progress`, `blocked`, `done`, `approval`
- append 시 dedupe + detail append + `TaskStore` 상태 자동 동기화

## 19. 보안 계층

### Secret Vault

- AES-256-GCM 암호화 (`src/security/secret-vault.ts`)
- 싱글턴 패턴 (`src/security/secret-vault-factory.ts`)
- master.key + secrets.db (`runtime/security/`)

### 인바운드 Seal

- 채널 수신 즉시 민감정보를 secret reference로 치환
- 에이전트에는 참조/암호문만 전달
- 복호화는 도구 실행 경로에서만 허용

### 감사 로그

`src/security/audit-log.ts`:
- SQLite 테이블: `audit_log`
- 이벤트: secret_access, tool_execute, approval_request/response, command_execute, provider_fallback

## 20. 데이터 저장소 맵

```
workspace/
  memory/memory.db              ← 메모리 DB
  runtime/
    security/
      master.key                ← AES-256-GCM 마스터 키
      secrets.db                ← 시크릿 저장소
    sessions/sessions.db        ← 세션 히스토리
    agent-sessions.db           ← 에이전트 백엔드 세션 (resume)
    tasks/tasks.db              ← 태스크 상태
    events/events.db            ← 워크플로우 이벤트
    decisions/decisions.db      ← 결정사항
    cron/cron.db                ← 크론 스케줄
    dlq/dlq.db                  ← 전송 실패 DLQ
    custom-tools/tools.db       ← 동적 도구
    inbound-files/<provider>/   ← 채널 첨부파일
```

## 21. 실패/복구 전략

- 루프: 논블로킹 유지
- Graceful shutdown: `SIGINT`/`SIGTERM` → 역순 정지
- 전송 실패: exponential backoff 재시도 → DLQ 보존
- 에이전트 백엔드 장애: CircuitBreaker 차단 → 동일 계열 fallback
- 프로바이더 장애: HealthScorer 기반 자동 순위 재조정
- 메모리/세션/이벤트/태스크: SQLite 기반 복구

## 22. 다이어그램

### 서비스 아키텍처
![Service Architecture](docs/diagrams/service-architecture.svg)

### 인바운드 파이프라인
![Inbound Pipeline](docs/diagrams/inbound-pipeline.svg)

### 프로바이더 복원력
![Provider Resilience](docs/diagrams/provider-resilience.svg)

### 역할 위임 흐름
![Role Delegation](docs/diagrams/role-delegation.svg)

### 오케스트레이션 실행 흐름
![Orchestrator Flow](docs/diagrams/orchestrator-flow.svg)

### 민감정보 Sealing
![Sensitive Seal Flow](docs/diagrams/sensitive-seal-flow.svg)

## 23. 핵심 추상화

| 개념 | 구현 | 용도 |
|------|------|------|
| `ServiceLike` | 인터페이스 | ServiceManager가 관리하는 서비스 단위 |
| `ChannelProvider` | `"slack" \| "discord" \| "telegram"` | 메시지 소스/목적지 |
| `ExecutorProvider` | `"chatgpt" \| "claude_code" \| "phi4_local" \| "openrouter"` | LLM 프로바이더 |
| `AgentBackendId` | `"claude_cli" \| "codex_cli" \| "claude_sdk" \| "codex_appserver"` | 에이전트 백엔드 |
| `AgentBackend` | 인터페이스 | `run(options)` → `AgentRunResult` |
| `ExecutionMode` | `"once" \| "task" \| "agent"` | 실행 전략 |
| `CircuitState` | `"closed" \| "open" \| "half_open"` | 장애 허용 상태 |
| `BudgetSection` | `{name, content, priority, estimated_tokens}` | 컨텍스트 윈도우 할당 |
| `ContentBlock` | 유니온 타입 | 구조화 출력 (text, code, table, chart 등) |
