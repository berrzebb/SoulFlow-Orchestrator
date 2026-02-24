# SoulFlow Orchestrator

`SoulFlow Orchestrator`는 Slack/Telegram/Discord에서 들어오는 메시지를 Headless 에이전트 실행으로 처리하는 비동기 오케스트레이션 런타임입니다.

## 현재 핵심 기능
- 멀티 채널 수신/응답: `slack`, `telegram`, `discord`
- Headless 실행기 라우팅: `chatgpt(codex CLI)`, `claude_code(CLI)`, `openrouter`, `phi4_local`
- 이중 루프 모델:
  - `Agent Loop`: 단일 목표를 최대 턴까지 연속 해결
  - `Task Loop`: 단계형 노드 실행/재개/승인 대기
- 컨텍스트 빌더:
  - `templates/*.md`, `agents/*.md`, `memory/MEMORY.md`, `memory/yyyy-mm-dd.md`, `skills/`
- 논블로킹 채널 처리:
  - 메시지 그룹핑, 스트리밍, typing, `/stop|/cancel|/중지`
- 전송 안정화:
  - 인라인 재시도 + 디스패치 재큐잉(backoff) + DLQ(`runtime/dlq/outbound.jsonl`)
- 긴 메시지 처리:
  - 채널별 분할 전송 + 파일 첨부 폴백
- 승인/제어 자동화:
  - 텍스트 승인 + Slack 리액션 승인/거부/보류/취소
  - Slack stop 리액션 기반 실행 중지
- 워크플로우 이벤트:
  - `assign/progress/blocked/done/approval` 이벤트 기록
  - 이벤트 -> TaskStore 상태 자동 동기화
- 대시보드:
  - 에이전트/태스크/결정/워크플로우 이벤트 조회

## 빠른 시작
### 1) 요구사항
- Node.js 20+
- 최소 1개 채널 Bot Token
- (선택) Podman/Docker + Ollama (`phi4_local` 런타임 사용 시)

### 2) 설치/빌드
```powershell
cd next
npm install
npm run build
```

### 3) 워크스페이스 및 환경 변수
런타임은 **실행 디렉터리(`process.cwd()`)를 workspace**로 사용합니다.

권장 실행 위치:
- `next/workspace`

`.env` 로딩 순서:
1. `<workspace>/.env`
2. `<workspace>/.env.local`
3. `<workspace>/../.env`
4. `<workspace>/../.env.local`

예시:
```powershell
cd next/workspace
copy ..\.env.example .env
```

최소 필수:
- Slack: `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`
- Discord: `DISCORD_BOT_TOKEN`, `DISCORD_DEFAULT_CHANNEL`

### 4) 실행
```powershell
cd next/workspace
node ../dist/main.js
```

개발 모드:
```powershell
cd next
npm run dev
```

### 5) 대시보드
- 기본 URL: `http://127.0.0.1:3789`
- `DASHBOARD_ENABLED=true`일 때 활성화

## 주요 환경 변수
### 채널/폴링
- `CHANNEL_PROVIDER`
- `CHANNEL_POLL_INTERVAL_MS`
- `CHANNEL_READ_LIMIT`

### 그룹핑/스트리밍
- `CHANNEL_GROUPING_ENABLED`
- `CHANNEL_GROUPING_WINDOW_MS`
- `CHANNEL_GROUPING_MAX_MESSAGES`
- `CHANNEL_STREAMING_ENABLED`
- `CHANNEL_STREAMING_INTERVAL_MS`
- `CHANNEL_STREAMING_MIN_CHARS`
- `CHANNEL_PROGRESS_PULSE`

### 전송 재시도/DLQ
- `CHANNEL_SEND_INLINE_RETRIES`
- `CHANNEL_SEND_INLINE_RETRY_MS`
- `CHANNEL_MANAGER_INLINE_RETRIES`
- `CHANNEL_DISPATCH_RETRY_MAX`
- `CHANNEL_DISPATCH_RETRY_BASE_MS`
- `CHANNEL_DISPATCH_RETRY_MAX_MS`
- `CHANNEL_DISPATCH_RETRY_JITTER_MS`
- `CHANNEL_DISPATCH_DLQ_ENABLED`
- `CHANNEL_DISPATCH_DLQ_PATH`

### 승인/리액션 제어
- `APPROVAL_REACTION_ENABLED`
- `CONTROL_REACTION_ENABLED`
- `REACTION_ACTION_TTL_MS`

### 장문 분할/파일 폴백
- `SLACK_TEXT_CHUNK_SIZE`
- `SLACK_TEXT_FILE_FALLBACK_THRESHOLD`
- `TELEGRAM_TEXT_CHUNK_SIZE`
- `TELEGRAM_TEXT_FILE_FALLBACK_THRESHOLD`

### 루프 제한
- `AGENT_LOOP_MAX_TURNS`
- `TASK_LOOP_MAX_TURNS`

### 실행기 선택
- `ORCH_EXECUTOR_PROVIDER`
- `CHATGPT_HEADLESS_COMMAND`, `CHATGPT_HEADLESS_ARGS`
- `CLAUDE_HEADLESS_COMMAND`, `CLAUDE_HEADLESS_ARGS`
- `OPENROUTER_API_KEY`
- `PHI4_API_BASE`, `PHI4_MODEL`

## 디렉터리 구조
```text
next/
  src/
  dist/
  dashboard/
  workspace/
    .env
    templates/
    agents/
    memory/
      MEMORY.md
      yyyy-mm-dd.md
    runtime/
      sessions/
      tasks/
        store.json
        details/
      events/
        events.jsonl
        index.json
      decisions/
      cron/
      dlq/
        outbound.jsonl
      inbound-files/
```

## 트러블슈팅
- 응답이 없을 때
  - 토큰/채널 ID 확인
  - 로그에서 `channel manager start failed` 확인
- 전송 실패가 반복될 때
  - `runtime/dlq/outbound.jsonl` 확인
  - 재시도 관련 env 조정
- 스트리밍이 약할 때
  - `CHANNEL_STREAMING_ENABLED=1`
  - `CHANNEL_STREAMING_INTERVAL_MS`, `CHANNEL_STREAMING_MIN_CHARS` 조정
- phi4 점검
```powershell
cd next
npm run health:phi4
```
