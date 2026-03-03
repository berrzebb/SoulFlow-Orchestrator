# 설치 및 시작

## 요구사항

| 항목 | 버전/조건 |
|------|----------|
| Node.js | 20 이상 |
| 채널 Bot Token | Slack · Telegram · Discord 중 최소 1개 |
| Claude API 키 (선택) | `claude_sdk` 백엔드 사용 시 |

## 설치

```bash
cd next
npm install
```

## 실행

```bash
# 개발 모드 (핫리로드)
cd next && npm run dev

# 프로덕션
npm run build
cd workspace && node ../dist/main.js
```

## Setup Wizard로 초기 설정

첫 실행 시 프로바이더가 설정되지 않으면 대시보드가 자동으로 **Setup Wizard**(`/setup`)로 이동합니다.

```
http://127.0.0.1:4200
```

Wizard에서 순서대로 설정합니다:
1. **AI 프로바이더** — Claude/Codex API 키 입력
2. **채널** — Slack/Telegram/Discord Bot Token 입력
3. **에이전트 설정** — 기본 역할 및 백엔드 선택

모든 설정은 Wizard에서 완료할 수 있습니다.

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
| 대시보드 접속 불가 | Settings에서 포트 변경 또는 포트 충돌 프로세스 종료 |
| SDK 백엔드 실패 | 로그에서 `backend_fallback` 확인 (자동으로 CLI로 전환됨) |

## 다음 단계

→ [대시보드 사용법](../guide/dashboard.md)
→ [채널 구조 이해하기](../core-concepts/channels.md)
→ [에이전트 백엔드 선택하기](../core-concepts/agents.md)
