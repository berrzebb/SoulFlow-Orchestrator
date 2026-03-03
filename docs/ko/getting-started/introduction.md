# SoulFlow란?

SoulFlow는 Slack · Telegram · Discord 메시지를 **헤드리스 에이전트**로 처리하는 비동기 오케스트레이션 런타임입니다.

채팅 채널에서 메시지를 받아 전문 에이전트에게 분배하고, 결과를 스트리밍으로 응답합니다. 서버는 항상 실행 중이며 사용자는 채팅만으로 작업을 의뢰합니다.

## 핵심 구성

| 구성 요소 | 역할 |
|----------|------|
| **채널** | Slack · Telegram · Discord · Web 메시지 수신/응답 |
| **오케스트레이터** | 메시지 분류 → 에이전트 실행 → 결과 반환 |
| **에이전트 백엔드** | Claude SDK · Claude CLI · Codex AppServer · Codex CLI |
| **역할 스킬** | butler → pm/pl → implementer/reviewer/debugger/validator |
| **보안 Vault** | AES-256-GCM 민감정보 관리 |
| **OAuth 연동** | GitHub · Google · Custom OAuth 2.0 외부 서비스 인증 |
| **대시보드** | 웹 기반 실시간 모니터링 및 관리 |

## 어떤 상황에 적합한가

**적합한 경우:**
- 채팅 채널에서 Claude/Codex를 24시간 운영하고 싶을 때
- 코드 분석, 파일 처리, 스케줄 실행 등을 채팅으로 위임하고 싶을 때
- 여러 채널(Slack + Telegram 동시)에서 동일 에이전트를 운영할 때
- GitHub, Google 등 외부 서비스를 에이전트에 연동하고 싶을 때

**적합하지 않은 경우:**
- 단순 챗봇 응답만 필요할 때 (Claude API 직접 호출이 더 단순)
- GUI 중심 상호작용이 필요할 때

## 처리 흐름

```
채널 메시지 수신
  → 민감정보 Sealing
  → 슬래시 커맨드 분기 (있을 경우)
  → 오케스트레이터 라우팅
  → 에이전트 백엔드 실행 (claude_sdk / claude_cli / ...)
  → 역할 스킬 적용 (butler → 전문가 위임)
  → 결과 스트리밍 응답
```

## 다음 단계

→ [설치 및 시작](./installation.md)
→ [대시보드 사용법](../guide/dashboard.md)
