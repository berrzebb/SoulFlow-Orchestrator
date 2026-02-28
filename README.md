# SoulFlow Orchestrator

`SoulFlow Orchestrator`는 Slack/Telegram/Discord에서 들어오는 메시지를 Headless 에이전트 실행으로 처리하는 비동기 오케스트레이션 런타임입니다.

## 핵심 기능

### 멀티 채널 오케스트레이션
- 채널 수신/응답: `slack`, `telegram`, `discord`
- Headless 실행기 라우팅: `chatgpt(codex CLI)`, `claude_code(CLI)`, `openrouter`, `phi4_local`
- 이중 루프 모델:
  - `Agent Loop`: 단일 목표를 최대 턴까지 연속 해결
  - `Task Loop`: 단계형 노드 실행/재개/승인 대기

### 컨텍스트 빌더
- `templates/*.md`, `agents/*.md`, `memory/memory.db`, `skills/`
- Context Budget: 프로바이더 토큰 한도 내 우선순위 기반 섹션 선택
- Prompt Version: 시스템 프롬프트 해시 기반 버전 추적

### 채널 처리 파이프라인
- 메시지 그룹핑, 스트리밍, typing 갱신
- 10개 슬래시 커맨드: `/stop`, `/help`, `/render`, `/secret`, `/memory`, `/decision`, `/cron`, `/promise`, `/reload`, `/status`
- 인바운드 민감정보 자동 sealing → secret 참조 치환
- 미디어 첨부(파일/URL) 자동 다운로드 및 분석 입력

### 전송 안정화
- `DispatchService`: 인라인 재시도 + 디스패치 재큐잉(backoff) + DLQ
- `TokenBucketRateLimiter`: 채널 API rate limit 보호
- `OutboundDedupePolicy`: 중복 응답 방지

### 프로바이더 복원력
- `CircuitBreaker`: closed → open (N회 실패) → half_open (타임아웃) → closed (성공)
- `HealthScorer`: 성공률·지연시간 기반 프로바이더 점수 산출 및 자동 순위 결정
- 자동 fallback 체인: 최적 프로바이더 우선, 차단 시 다음 후보

### 승인/제어 자동화
- 텍스트 승인 + Slack 리액션 승인/거부/보류/취소
- Slack stop 리액션 기반 실행 중지
- 서브에이전트 cascade cancel

### 워크플로우 이벤트
- `assign/progress/blocked/done/approval` 이벤트 기록
- 이벤트 → TaskStore 상태 자동 동기화

### MCP (Model Context Protocol) 통합
- `McpClientManager`: stdio/SSE 기반 MCP 서버 연결
- 프로젝트별 MCP 도구 자동 등록
- Codex/Claude CLI에 MCP 서버 설정 자동 주입

### 대시보드
- 에이전트/태스크/결정/워크플로우 이벤트 조회
- SSE 기반 실시간 업데이트
- 포트 충돌 시 자동 fallback

## 보안 우선 정책
- 민감정보/보안 규칙은 다른 모든 규칙보다 우선합니다.
- 채널 입력 수신 직후 민감정보를 키 기반 secret 참조로 치환합니다.
  - 키 규칙: `inbound.<provider>.c<chatHash>.<type>.v<valueHash>`
- 세션/메모리 저장 시 민감정보 평문/secret ref/ciphertext를 남기지 않습니다.
- 에이전트에는 참조/암호문만 전달되며, 복호화는 도구 실행 경로에서만 허용됩니다.
- 키 미식별 또는 암호문 무효 시:
  - 복호화 금지
  - `secret_resolution_required` 템플릿으로 즉시 사용자 안내
  - 에이전트 실행 이전에 오케스트레이터가 선차단

## 아키텍처 다이어그램

다이어그램은 `diagram_render` 도구(`@vercel/beautiful-mermaid`)로 생성된 SVG입니다.

### 서비스 아키텍처
![Service Architecture](docs/diagrams/service-architecture.svg)

### 인바운드 파이프라인
![Inbound Pipeline](docs/diagrams/inbound-pipeline.svg)

### 프로바이더 복원력
![Provider Resilience](docs/diagrams/provider-resilience.svg)

### 레거시 (참고용)
![Orchestrator Flow](docs/diagrams/orchestrator-flow.svg)
![Sensitive Seal Flow](docs/diagrams/sensitive-seal-flow.svg)

## 빠른 시작

### 1) 요구사항
- Node.js 20+
- 최소 1개 채널 Bot Token
- (선택) Podman/Docker + Ollama (`phi4_local` 런타임 사용 시)

### 2) 설치/빌드
```powershell
cd next
npm install
```

프로덕션 빌드:
```powershell
npm run build
```

### 3) 워크스페이스 및 환경 변수
런타임은 **실행 디렉터리(`process.cwd()`)를 workspace**로 사용합니다.

권장 실행 위치: `next/workspace`

`.env` 로딩 순서:
1. `<workspace>/.env`
2. `<workspace>/.env.local`
3. `<workspace>/../.env`
4. `<workspace>/../.env.local`

최소 필수:
- Slack: `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`
- Discord: `DISCORD_BOT_TOKEN`, `DISCORD_DEFAULT_CHANNEL`

권장(자기 메시지 재처리 방지):
- `SLACK_BOT_USER_ID`, `TELEGRAM_BOT_USER_ID`, `DISCORD_BOT_USER_ID`

### 4) 실행
개발 모드(핫리로드):
```powershell
cd next && npm run dev
```

프로덕션 실행:
```powershell
cd next/workspace && node ../dist/main.js
```

### 5) 대시보드
- 기본 URL: `http://127.0.0.1:3789`
- `DASHBOARD_ENABLED=true`일 때 활성화
- 포트 충돌 시 자동 fallback — 실제 URL은 로그의 `[runtime] dashboard ...`에서 확인

### 6) 슬래시 명령

| 명령 | 설명 |
|------|------|
| `/help` | 공통 명령/사용법 출력 |
| `/stop` · `/cancel` · `/중지` | 현재 채널 활성 작업 중지 |
| `/render status\|markdown\|html\|plain\|reset` | 렌더 모드 설정/조회/초기화 |
| `/render link\|image indicator\|text\|remove` | 차단된 링크/이미지 표현 방식 |
| `/secret status\|list\|set\|get\|reveal\|remove` | AES-256-GCM secret vault 관리 |
| `/secret encrypt <text>` · `/secret decrypt <cipher>` | 즉시 암복호화 |
| `/memory status\|list\|today\|longterm\|search <q>` | 메모리 조회/검색 |
| `/decision status\|list\|set <key> <value>` | 결정사항 관리 |
| `/cron status\|list\|add\|remove` | 크론 스케줄 관리 |
| `/promise status\|list\|resolve <id> <value>` | Promise/지연 실행 관리 |
| `/reload config\|tools\|skills` | 설정/도구/스킬 핫 리로드 |
| `/status` | 런타임 상태 요약 (도구·스킬 목록 포함) |

## 주요 환경 변수

### 채널/폴링
`CHANNEL_PROVIDER`, `CHANNEL_POLL_INTERVAL_MS`, `CHANNEL_READ_LIMIT`

### 대시보드
`DASHBOARD_ENABLED`, `DASHBOARD_HOST`, `DASHBOARD_PORT`, `DASHBOARD_ASSETS_DIR`, `DASHBOARD_PORT_FALLBACK`

### 그룹핑/스트리밍
`CHANNEL_GROUPING_ENABLED`, `CHANNEL_GROUPING_WINDOW_MS`, `CHANNEL_GROUPING_MAX_MESSAGES`,
`CHANNEL_STREAMING_ENABLED`, `CHANNEL_STREAMING_INTERVAL_MS`, `CHANNEL_STREAMING_MIN_CHARS`,
`CHANNEL_SUPPRESS_FINAL_AFTER_STREAM`, `CHANNEL_PROGRESS_PULSE`, `CHANNEL_SESSION_HISTORY_MAX_AGE_MS`

### 전송 재시도/DLQ
`CHANNEL_DISPATCH_RETRY_MAX`, `CHANNEL_DISPATCH_RETRY_BASE_MS`, `CHANNEL_DISPATCH_RETRY_MAX_MS`,
`CHANNEL_DISPATCH_RETRY_JITTER_MS`, `CHANNEL_DISPATCH_DLQ_ENABLED`, `CHANNEL_DISPATCH_DLQ_PATH`

### 승인/리액션 제어
`APPROVAL_REACTION_ENABLED`, `CONTROL_REACTION_ENABLED`, `REACTION_ACTION_TTL_MS`

### 루프 제한
`AGENT_LOOP_MAX_TURNS`, `TASK_LOOP_MAX_TURNS`

### 실행기 선택
`ORCH_EXECUTOR_PROVIDER`, `ORCH_ORCHESTRATOR_PROVIDER`,
`CHATGPT_HEADLESS_COMMAND`, `CHATGPT_HEADLESS_ARGS`,
`CLAUDE_HEADLESS_COMMAND`, `CLAUDE_HEADLESS_ARGS`,
`ORCH_CODEX_SANDBOX_MODE`, `ORCH_CODEX_ADD_DIRS`, `ORCH_CODEX_BYPASS_SANDBOX`,
`ORCH_CLAUDE_PERMISSION_MODE`

### MCP 통합
`ORCH_MCP_ENABLED`, `ORCH_MCP_ENABLE_ALL_PROJECT`, `ORCH_MCP_SERVERS_FILE`,
`ORCH_MCP_SERVERS_JSON`, `ORCH_MCP_SERVER_NAMES`, `ORCH_MCP_STARTUP_TIMEOUT_SEC`

### LLM 프로바이더
`OPENROUTER_API_KEY`, `PHI4_API_BASE`, `PHI4_MODEL`

## 디렉터리 구조
```text
next/
  docs/diagrams/          ← SVG 아키텍처 다이어그램
  scripts/                ← 다이어그램 생성 등 유틸리티 스크립트
  src/
    agent/                ← 에이전트 런타임 (loop, memory, context, tools, skills, subagents)
    bus/                  ← MessageBus (inbound/outbound pub/sub)
    channels/             ← 채널 매니저, 커맨드, 디스패치, 승인, 세션 기록
    config/               ← Zod 기반 설정 스키마 + env 파싱
    cron/                 ← 크론 스케줄러 (SQLite)
    dashboard/            ← 웹 대시보드 (API + SSE + 정적 파일)
    decision/             ← 결정사항 서비스 (SQLite, scope hierarchy)
    events/               ← 워크플로우 이벤트 (SQLite)
    heartbeat/            ← 하트비트 서비스
    mcp/                  ← MCP 클라이언트 매니저
    ops/                  ← 운영 서비스 (health, watchdog, bridge)
    orchestration/        ← 오케스트레이션 (once/agent/task 실행 모드)
    providers/            ← LLM 프로바이더 (circuit breaker, health scorer)
    runtime/              ← 서비스 매니저, 인스턴스 락
    security/             ← Secret Vault (AES-256-GCM), 인바운드 seal
    session/              ← 세션 저장소
    skills/               ← 13개 플러그인 스킬
    templates/            ← 템플릿 엔진
    utils/                ← 공통 유틸리티 (SQLite helper, env loader)
  tests/                  ← 545개 테스트 (vitest)
  workspace/
    .env                  ← 환경 변수
    templates/            ← 시스템 프롬프트 템플릿
    agents/               ← 에이전트 역할 정의
    memory/memory.db      ← 메모리 DB
    runtime/
      security/           ← master.key, secrets.db
      sessions/           ← sessions.db
      tasks/              ← tasks.db
      events/             ← events.db
      decisions/          ← decisions.db
      cron/               ← cron.db
      dlq/                ← dlq.db
      custom-tools/       ← tools.db
      inbound-files/      ← 채널 첨부파일 다운로드
```

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| `another instance is active` | 동일 Bot Token으로 실행 중인 다른 프로세스를 정리 |
| 응답 없음 | 토큰/채널 ID 확인, 로그에서 `channel manager start failed` 확인 |
| 대시보드 시작 실패 | 자동 fallback 동작 — 로그의 최종 URL 사용. `DASHBOARD_PORT_FALLBACK=0`으로 비활성화 |
| 전송 실패 반복 | `runtime/dlq/dlq.db` 확인, 재시도 env 조정 |
| 스트리밍 미동작 | `CHANNEL_STREAMING_ENABLED=1`, interval/min_chars 조정 |
| phi4 점검 | `npm run health:phi4` |
| phi4 불필요 | `ORCH_EXECUTOR_PROVIDER`로 chatgpt/claude_code 사용 가능 |
