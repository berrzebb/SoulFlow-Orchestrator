# SoulFlow란?

SoulFlow는 Slack · Telegram · Discord 메시지를 **헤드리스 에이전트**로 처리하는 비동기 오케스트레이션 런타임입니다.

채팅 채널에서 메시지를 받아 전문 에이전트에게 분배하고, 결과를 스트리밍으로 응답합니다. 서버는 항상 실행 중이며 사용자는 채팅만으로 작업을 의뢰합니다.

## 핵심 구성

| 구성 요소 | 역할 |
|----------|------|
| **채널** | Slack · Telegram · Discord · Web 메시지 수신/응답 |
| **오케스트레이터** | 메시지 분류 → 에이전트 실행 → 결과 반환 |
| **에이전트 백엔드** | 8개 백엔드: Claude/Codex × CLI/SDK + Gemini CLI + OpenAI 호환 + OpenRouter + Container CLI |
| **역할 스킬** | butler → pm/pl → implementer/reviewer/debugger/validator |
| **보안 Vault** | AES-256-GCM 민감정보 관리 |
| **OAuth 연동** | GitHub · Google · Custom OAuth 2.0 외부 서비스 인증 |
| **대시보드** | 웹 기반 실시간 모니터링 및 관리 |

## 어떤 상황에 적합한가

**적합한 경우:**
- **다중 에이전트 협업** — 병렬 전문가(시장 분석가 + 기술 분석가 + 전략가)가 크리틱 품질 게이트와 함께 작동, 각 에이전트가 독립 대화 컨텍스트 보유
- **자율 개발 파이프라인** — 대화형 스펙 작성 → 계획 수립 → 태스크별 fresh context 순차 구현 → 코드 리뷰 → 검증 + 자동 수정 루프
- **시각적 워크플로우 자동화** — 42종 노드(HTTP, Code, LLM, IF, Merge, Approval, HITL, Form 등)로 그래프 에디터에서 DAG 설계, 또는 에이전트가 자연어로 워크플로우 생성 ("매일 아침 RSS 크롤링해서 요약해줘")
- **샌드박스 코드 실행** — Python, Go, Rust, Ruby 등 7개 언어를 격리 컨테이너에서 엄격한 리소스 제한과 함께 워크플로우 파이프라인의 일부로 실행
- **24시간 채팅 기반 운영** — Slack · Telegram · Discord에서 Claude/Codex/Gemini 에이전트를 8개 백엔드 옵션, CircuitBreaker 자동 fallback, 인증 프로필 로테이션과 함께 운영
- **멀티 채널 에이전트 공유** — 하나의 오케스트레이터가 Slack + Telegram + Discord를 동시에 서빙, 채널별 설정 가능
- **외부 서비스 연동** — OAuth 2.0 (GitHub, Google, 커스텀) 자동 토큰 주입 및 401 자동 갱신 재시도
- **Human-in-the-Loop 워크플로우** — 승인 게이트, `[ASK_USER]` 마커로 워크플로우를 일시 정지하고 원래 채팅 채널로 질문 전송, 사용자 응답 시 자동 재개

**적합하지 않은 경우:**
- 단순 챗봇 응답만 필요할 때 (Claude API 직접 호출이 더 단순)
- GUI 중심 상호작용이 필요할 때 (SoulFlow는 채팅 우선, 대시보드는 모니터링/관리 용도)
- 실시간 서브초 지연이 필요할 때 (오케스트레이션 라우팅 오버헤드 존재)

## 처리 흐름

```
채널 메시지 수신
  → 민감정보 Sealing
  → 슬래시 커맨드 분기 (있을 경우)
  → 확인 가드 체크
  → 오케스트레이터 분류기 (once / agent / task / phase)
  ├─ once/agent/task → 에이전트 백엔드 실행 (claude_sdk / claude_cli / ...)
  │    → 역할 스킬 적용 (butler → 전문가 위임)
  │    → 결과 스트리밍 응답
  └─ phase → 워크플로우 엔진
       → Phase Loop (병렬 에이전트 + 크리틱 게이트)
       → DAG 실행기 (42종 노드)
       → 인터랙션 노드 (HITL / 승인 / 폼) ←→ 채널 피드백
       → 결과 스트리밍 응답
```

## 다음 단계

→ [설치 및 시작](./installation.md)
→ [대시보드 사용법](../guide/dashboard.md)
