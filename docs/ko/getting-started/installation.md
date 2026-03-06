# 설치 및 시작

## 요구사항

| 항목 | 조건 |
|------|------|
| Docker 또는 Podman | 컨테이너 런타임 (권장) |
| 채널 Bot Token | Slack · Telegram · Discord 중 최소 1개 |
| AI 프로바이더 API 키 | Claude, OpenAI, OpenRouter 등 |
| (선택) GPU | 로컬 Ollama 오케스트레이터 LLM 분류기 사용 시 |

## Docker (권장)

SoulFlow를 실행하는 권장 방법은 Docker Compose입니다. `full` 이미지에 Claude Code, Codex CLI, Gemini CLI가 사전 설치되어 있습니다.

### 프로덕션

```bash
docker compose up -d
```

3개 서비스가 시작됩니다:
- **orchestrator** — SoulFlow 런타임 + 대시보드 (포트 4200)
- **ollama** — 요청 분류용 로컬 LLM (GPU 가속)
- **docker-proxy** — 컨테이너 에이전트 격리를 위한 보안 Docker 소켓 프록시

### 개발 (라이브 리로드)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

소스 파일이 볼륨으로 마운트되어 코드 변경이 자동으로 반영됩니다.

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DASHBOARD_PORT` | `4200` | 대시보드 포트 매핑 |
| `WORKSPACE_PATH` | `./workspace2` | 영속 워크스페이스 데이터의 호스트 경로 |

### 컨테이너 아키텍처

```
docker-compose.yml
  ├─ docker-proxy     ← 보안 Docker 소켓 프록시 (POST 전용, 컨테이너 전용)
  ├─ ollama           ← 오케스트레이터 LLM (GPU 패스스루, 6GB 메모리 제한)
  └─ orchestrator     ← SoulFlow 런타임 (CLI 에이전트 포함 full 이미지)
       ├─ /data       ← 워크스페이스 볼륨 (설정, 런타임 DB, 스킬)
       ├─ cli-auth-*  ← CLI OAuth 토큰 영속 (Claude, Codex, Gemini)
       └─ port 4200   ← 대시보드 + API
```

### Dockerfile 스테이지

| 스테이지 | 용도 |
|----------|------|
| `deps` | Node.js 의존성 + 네이티브 빌드 설치 (better-sqlite3) |
| `build` | TypeScript 컴파일 + Vite 프론트엔드 빌드 |
| `production` | 최소 런타임 이미지 (node:22-slim + python3 + tini) |
| `full` | production + Claude Code, Codex CLI, Gemini CLI 사전 설치 |
| `dev` | devDependencies 포함 개발 이미지 + watch 모드 |

---

## 로컬 (비권장)

> 로컬 설치는 권장하지 않습니다. 컨테이너 배포가 CLI 에이전트 격리, 일관된 환경, 간편한 설정을 제공합니다. 개발 용도이거나 컨테이너를 사용할 수 없는 경우에만 사용하세요.

### 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | 20 이상 |

### 설치 및 실행

```bash
cd next
npm install

# 개발 모드 (핫리로드)
npm run dev

# 프로덕션
npm run build
cd workspace && node ../dist/main.js
```

---

## Setup Wizard로 초기 설정

첫 실행 시 프로바이더가 설정되지 않으면 대시보드가 자동으로 **Setup Wizard**(`/setup`)로 이동합니다.

```
http://127.0.0.1:4200
```

Wizard에서 순서대로 설정합니다:
1. **AI 프로바이더** — Claude/Codex API 키 입력
2. **채널** — Slack/Telegram/Discord Bot Token 입력
3. **에이전트 설정** — 기본 역할 및 백엔드 선택

`.env` 파일을 직접 작성할 필요 없이, Wizard에서 모든 설정을 완료할 수 있습니다.

## 동작 확인

1. **대시보드 접속** — `http://127.0.0.1:4200`
2. **채널에서 테스트** — 채팅창에 `/status` 입력
3. **자가진단** — `/doctor` 입력 후 이상 항목 확인

## 채널별 Bot 설정

### Slack

1. [api.slack.com/apps](https://api.slack.com/apps) → 앱 생성
2. **Socket Mode** 활성화 → App-Level Token 발급 (`xapp-...`)
3. **OAuth Scopes** 추가: `chat:write`, `channels:history`, `groups:history`, `im:history`
4. **Event Subscriptions** → `message.channels`, `message.groups`, `message.im` 구독
5. 워크스페이스에 설치 → Bot Token (`xoxb-...`) 복사
6. 대시보드 **Setup Wizard** 또는 **Channels** 페이지에서 토큰 입력

### Telegram

1. [@BotFather](https://t.me/botfather) → `/newbot` 명령으로 봇 생성
2. 발급된 토큰을 대시보드 **Setup Wizard** 또는 **Channels** 페이지에서 입력

### Discord

1. [discord.com/developers](https://discord.com/developers/applications) → 애플리케이션 생성
2. Bot 탭 → Token 발급, **Message Content Intent** 활성화
3. OAuth2 URL로 서버에 봇 초대 (권한: `Send Messages`, `Read Message History`)
4. 대시보드 **Setup Wizard** 또는 **Channels** 페이지에서 토큰 입력

## 트러블슈팅

| 증상 | 확인 사항 |
|------|----------|
| `another instance is active` | 동일 토큰으로 실행 중인 다른 프로세스 종료 |
| 응답 없음 | 토큰/채팅 ID 재확인, `/doctor` 실행 |
| 대시보드 접속 불가 | `DASHBOARD_PORT` 확인 또는 포트 충돌 프로세스 종료 |
| SDK 백엔드 실패 | 로그에서 `backend_fallback` 확인 (자동으로 CLI로 전환됨) |
| 컨테이너 시작 실패 | Docker/Podman 데몬 실행 확인, `docker compose logs` 확인 |
| Ollama 무응답 | GPU 사용 가능 여부 확인, `docker compose logs ollama` 확인 |

## 다음 단계

→ [대시보드 사용법](../guide/dashboard.md)
→ [채널 구조 이해하기](../core-concepts/channels.md)
→ [에이전트 백엔드 선택하기](../core-concepts/agents.md)
