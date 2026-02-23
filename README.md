# SoulFlow Orchestrator

`SoulFlow Orchestrator`는 Slack/Telegram/Discord 채널 입력을 받아 Headless 에이전트 실행으로 처리하는 TypeScript 런타임입니다.

## 핵심 기능
- 다중 채널 입력 수집: `slack`, `telegram`, `discord`
- Headless 실행기: `chatgpt(codex CLI)`, `claude_code(CLI)`, `openrouter`, `phi4_local`
- 루프 모델:
  - `Agent Loop`: 한 번에 끝까지 해결
  - `Task Loop`: 단계적 실행/재개/승인 대기
- 컨텍스트 구성: `templates/*.md`, `memory/MEMORY.md`, `memory/yyyy-mm-dd.md`, `skills/`
- 스트리밍/타이핑/중지: `/stop`, `/cancel`, `/중지`
- 메시지 그룹핑: 짧은 시간 연속 채팅을 묶어 1회 문맥 처리
- 대시보드: 상태/작업/결정 로그 API 및 웹 UI

## 빠른 시작
## 1) 요구사항
- Node.js 20+
- 채널 Bot Token (최소 1개)
- (선택) Podman/Docker + Ollama (`phi4_local` 오케스트레이터 사용 시)

## 2) 설치/빌드
```powershell
cd next
npm install
npm run build
```

## 3) 환경 변수 설정
런타임은 `process.cwd()`를 workspace로 사용합니다.

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

필수 설정 예:
- `SLACK_BOT_TOKEN`, `SLACK_DEFAULT_CHANNEL`
- 또는 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`
- 또는 `DISCORD_BOT_TOKEN`, `DISCORD_DEFAULT_CHANNEL`

## 4) 실행
```powershell
cd next/workspace
node ../dist/main.js
```

개발 실행:
```powershell
cd next
npm run dev
```

## 5) 대시보드
- 기본 URL: `http://127.0.0.1:3789`
- 기본값: `DASHBOARD_ENABLED=true`

## 주요 환경 변수
- 채널/폴링
  - `CHANNEL_PROVIDER`
  - `CHANNEL_POLL_INTERVAL_MS`
  - `CHANNEL_READ_LIMIT`
- 메시지 그룹핑
  - `CHANNEL_GROUPING_ENABLED`
  - `CHANNEL_GROUPING_WINDOW_MS`
  - `CHANNEL_GROUPING_MAX_MESSAGES`
- 스트리밍/진행 표시
  - `CHANNEL_STREAMING_ENABLED`
  - `CHANNEL_STREAMING_INTERVAL_MS`
  - `CHANNEL_STREAMING_MIN_CHARS`
  - `CHANNEL_PROGRESS_PULSE`
- 루프 제한
  - `AGENT_LOOP_MAX_TURNS`
  - `TASK_LOOP_MAX_TURNS`
- 실행기 선택
  - `ORCH_EXECUTOR_PROVIDER`
  - `CHATGPT_HEADLESS_COMMAND`, `CHATGPT_HEADLESS_ARGS`
  - `CLAUDE_HEADLESS_COMMAND`, `CLAUDE_HEADLESS_ARGS`
  - `OPENROUTER_API_KEY`
  - `PHI4_API_BASE`, `PHI4_MODEL`

## 디렉터리 구조
```text
next/
  src/                    # 런타임 소스
  dist/                   # 빌드 출력
  dashboard/              # 대시보드 정적 자산
  workspace/              # 실행 workspace (권장)
    .env
    templates/
    memory/
    skills/
    runtime/
      sessions/
      tasks/
      decisions/
      cron/
```

## 트러블슈팅
- 채널 응답 없음
  - 토큰/채널 ID 확인
  - 런타임 로그에서 `channel manager start failed` 확인
- 타이핑만 보이고 중간 스트림 없음
  - `CHANNEL_STREAMING_ENABLED=1` 확인
  - `CHANNEL_PROGRESS_PULSE=1` 권장
- phi4 점검
```powershell
cd next
npm run health:phi4
```
