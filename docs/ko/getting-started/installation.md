# 설치 및 시작

## 요구사항

| 항목 | 조건 |
|------|------|
| Docker 또는 Podman | 컨테이너 런타임 (권장) |
| AI 프로바이더 API 키 | Claude, OpenAI, OpenRouter 등 |
| (선택) 채널 Bot Token | Slack · Telegram · Discord — 토큰 없이도 Web 채널로 바로 사용 가능 |
| (선택) GPU | 로컬 Ollama 오케스트레이터 LLM 분류기 사용 시 |

---

## 빠른 시작 (5분)

### 1단계: 저장소 클론

```bash
git clone https://github.com/berrzebb/SoulFlow-Orchestrator.git
cd SoulFlow-Orchestrator
```

### 2단계: 환경 시작

SoulFlow는 플랫폼별 실행 스크립트를 제공합니다:

**Linux/macOS:**
```bash
chmod +x run.sh
./run.sh prod --workspace=/path/to/your/workspace
```

**Windows (PowerShell):**
```powershell
.\run.ps1 prod --workspace=D:\your\workspace
```

**Windows (CMD):**
```cmd
run.cmd prod --workspace=D:\your\workspace
```

> `--workspace` 는 설정 파일, 런타임 DB, 스킬이 저장되는 **영속 디렉터리** 경로입니다.
> 존재하지 않는 경로를 지정하면 자동 생성됩니다.

### 3단계: 브라우저에서 Setup Wizard 진행

```
http://localhost:4200
```

프로바이더가 설정되지 않으면 자동으로 **Setup Wizard**(`/setup`)로 이동합니다:

1. **AI 프로바이더** — Claude/OpenAI/OpenRouter API 키 입력
2. **채널** — Slack/Telegram/Discord Bot Token 입력 *(선택 — 토큰 없이도 Web 채널로 바로 채팅 가능)*
3. **에이전트 설정** — 기본 역할 및 백엔드 선택

`.env` 파일 없이 Wizard 하나로 모든 설정을 완료할 수 있습니다.

### 3.5단계: CLI 에이전트 로그인 (CLI 백엔드 사용 시 필수)

Wizard에서 CLI 기반 에이전트 백엔드(`claude_cli`, `codex_cli`, `gemini_cli`)를 선택한 경우, 사용 전 CLI 에이전트 인증이 필요합니다.

CLI 에이전트 인증 정보는 시스템 루트(`~/.claude` 등)가 아닌 **`{workspace}/.agents/`** 경로에 저장됩니다. `run.sh login` 명령이 이 경로에 인증 파일을 씁니다:

```bash
# Linux/macOS
./run.sh login claude --workspace=/path/to/workspace   # Claude Code
./run.sh login codex  --workspace=/path/to/workspace   # Codex CLI
./run.sh login gemini --workspace=/path/to/workspace   # Gemini CLI

# Windows
.\run.ps1 login claude --workspace=D:\workspace
```

> **왜 별도 로그인이 필요한가?** CLI 에이전트는 컨테이너 내부에서 격리된 인증 저장소로 별도 프로세스로 실행됩니다. 컨테이너는 로컬 `~/.claude`가 아닌 `{workspace}/.agents`를 에이전트 홈으로 마운트합니다.

로그인 후 대시보드 → **Providers** 페이지에서 인증 상태를 확인하거나, 시작 로그에서 다음을 확인하세요:
```
cli-auth claude authenticated=true
```

> **SDK 백엔드**(`claude_sdk`, `codex_appserver`)는 3단계에서 입력한 API 키를 사용하므로 별도 로그인이 필요하지 않습니다.

### 4단계: 동작 확인

채팅 채널에서 다음을 입력해 검증합니다:

```
/status   → 도구·스킬 목록 확인
/doctor   → 서비스 건강 상태 자가진단
```

---

## run.sh / run.ps1 / run.cmd 상세

### 명령

| 명령 | 설명 |
|------|------|
| `dev` | 개발 환경 (소스 마운트 + 핫 리로드, 포트 4200) |
| `test` | 테스트 환경 (포트 4201) |
| `staging` | 스테이징 환경 (포트 4202) |
| `prod` | 프로덕션 환경 (`full` 이미지, 포트 4200) |
| `build` | Docker 이미지만 빌드 |
| `down` | 모든 환경 중지 |
| `status` | 실행 중인 환경 상태 확인 |
| `logs [env]` | 로그 스트리밍 (`logs prod`) |
| `login <agent>` | 에이전트 CLI 로그인 (`login claude`) |

### 옵션

| 옵션 | 설명 |
|------|------|
| `--workspace=PATH` | 워크스페이스 경로 **(필수)** |
| `--web-port=PORT` | 대시보드 포트 오버라이드 |
| `--instance=NAME` | 인스턴스 이름 (다중 인스턴스 스케일링) |
| `--watch` | 전체 소스 마운트 + 핫 리로드 (tsx watch) |
| `--watch=web` | 웹 소스만 마운트 + Vite --watch |

### 환경별 프리셋

| 환경 | 이미지 | NODE_ENV | 메모리 | CPU |
|------|--------|----------|--------|-----|
| `dev` | dev | development | 1G | 2 |
| `test` | production | test | 1G | 2 |
| `staging` | production | production | 1G | 2 |
| `prod` | full (CLI 에이전트 포함) | production | 2G | 4 |

### 에이전트 로그인

CLI 에이전트(Claude Code, Codex, Gemini)는 워크스페이스별 독립 인증 정보를 사용합니다.
초기 설정 시 한 번 실행하면 `{workspace}/.agents/` 에 영속 저장됩니다.

```bash
# Linux/macOS
./run.sh login claude --workspace=/path/to/workspace
./run.sh login codex  --workspace=/path/to/workspace
./run.sh login gemini --workspace=/path/to/workspace

# Windows
.\run.ps1 login claude --workspace=D:\workspace
```

### 다중 인스턴스 스케일링

동일 워크스페이스에서 여러 인스턴스를 동시에 운영할 수 있습니다.
`--instance` 지정 시 공유 인프라(Redis, docker-proxy)를 자동으로 먼저 기동합니다.

```bash
./run.sh prod --workspace=/path/to/workspace --instance=worker1 --web-port=4200
./run.sh prod --workspace=/path/to/workspace --instance=worker2 --web-port=4201
```

---

## Docker Compose 직접 사용 (고급)

run.sh 없이 docker compose를 직접 사용하려면:

```bash
# 기본 실행
HOST_WORKSPACE=/path/to/workspace docker compose -f docker/docker-compose.yml up -d

# GPU 프로필 (Ollama LLM 분류기)
docker compose -f docker/docker-compose.yml --profile gpu up -d

# Redis 메시지 버스 (다중 인스턴스)
docker compose -f docker/docker-compose.yml --profile redis up -d
```

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `HOST_WORKSPACE` | — | 워크스페이스 호스트 경로 **(필수)** |
| `WEB_PORT` | `4200` | 대시보드 포트 |
| `BUILD_TARGET` | `production` | Dockerfile 빌드 스테이지 |
| `NODE_ENV` | `production` | Node.js 환경 |
| `BUS_BACKEND` | `memory` | 메시지 버스 (`memory` 또는 `redis`) |
| `BUS_REDIS_URL` | `redis://redis:6379` | Redis 연결 URL |

### 컨테이너 아키텍처

```
docker/docker-compose.yml
  ├─ docker-proxy     ← 보안 Docker 소켓 프록시 (POST 전용)
  ├─ ollama           ← 오케스트레이터 LLM [프로필: gpu]
  ├─ redis            ← 메시지 버스 [프로필: redis] (256MB, AOF)
  └─ orchestrator     ← SoulFlow 런타임
       ├─ /data       ← 워크스페이스 볼륨 (설정, DB, 스킬)
       ├─ /agents     ← CLI 에이전트 인증 토큰 (Claude, Codex, Gemini)
       └─ :4200       ← 대시보드 + API
```

### Dockerfile 스테이지

| 스테이지 | 용도 |
|----------|------|
| `deps` | Node.js 의존성 + 네이티브 빌드 (better-sqlite3) |
| `build` | TypeScript 컴파일 + Vite 프론트엔드 빌드 |
| `production` | 최소 런타임 이미지 (node:22-slim + python3 + tini) |
| `full` | production + Claude Code, Codex CLI, Gemini CLI |
| `dev` | devDependencies 포함 + watch 모드 |

---

## 로컬 실행 (비권장)

> 컨테이너 배포가 CLI 에이전트 격리, 일관된 환경, 간편한 설정을 제공하므로 권장합니다.
> 컨테이너를 사용할 수 없는 경우에만 로컬을 사용하세요.

```bash
cd next
npm install

# 개발 모드 (핫리로드)
npm run dev

# 프로덕션 빌드
npm run build
node dist/main.js
```

---

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

---

## 트러블슈팅

| 증상 | 확인 사항 |
|------|----------|
| `--workspace 파라미터가 필요합니다` | run 스크립트에 `--workspace=PATH` 추가 |
| `another instance is active` | 동일 토큰으로 실행 중인 다른 프로세스 종료 |
| 응답 없음 | 토큰/채팅 ID 재확인, `/doctor` 실행 |
| 대시보드 접속 불가 | `--web-port` 확인 또는 포트 충돌 프로세스 종료 |
| SDK 백엔드 실패 | 로그에서 `backend_fallback` 확인 (자동으로 CLI로 전환됨) |
| 컨테이너 시작 실패 | Docker/Podman 데몬 실행 확인, `run.sh logs` 확인 |
| 에이전트 로그인 실패 | `./run.sh login claude --workspace=...` 재실행 |
| 로그에 `cli-auth ... authenticated=false` | `./run.sh login <agent> --workspace=...` 실행 (3.5단계 참조) |
| CLI 에이전트가 설정 후에도 응답하지 않음 | `{workspace}/.agents/.claude` (또는 `.codex`) 존재 여부 확인; 올바른 workspace 경로로 로그인했는지 확인 |

## 다음 단계

→ [대시보드 사용법](../guide/dashboard.md)
→ [채널 구조 이해하기](../core-concepts/channels.md)
→ [에이전트 백엔드 선택하기](../core-concepts/agents.md)
