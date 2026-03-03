# 에이전트

SoulFlow의 에이전트 시스템은 두 계층으로 구성됩니다: **백엔드**(실행 엔진)와 **역할 스킬**(행동 지침).

## 에이전트 백엔드

메시지를 실제로 처리하는 실행 엔진입니다.

| 백엔드 | 방식 | 장점 | 자동 Fallback |
|--------|------|------|---------------|
| `claude_sdk` | 네이티브 SDK | 스트리밍, tool loop 내장 | → `claude_cli` |
| `claude_cli` | Headless CLI 래퍼 | 안정적, 범용 | — |
| `codex_appserver` | 네이티브 AppServer | 병렬 실행, tool loop 내장 | → `codex_cli` |
| `codex_cli` | Headless CLI 래퍼 | 샌드박스 모드 지원 | — |

### 백엔드 선택 기준

- **스트리밍이 중요하다** → `claude_sdk` (가장 빠른 첫 응답)
- **안정성이 우선이다** → `claude_cli` (배치/프로덕션 환경)
- **Codex/OpenAI를 쓴다** → `codex_appserver` 또는 `codex_cli`

대시보드 → **Providers** 페이지에서 여러 백엔드를 동시에 등록하고 우선순위를 설정할 수 있습니다.

### CircuitBreaker

백엔드 오류가 연속으로 발생하면 서킷 브레이커가 동작합니다.

```
closed (정상) → open (차단) → half_open (복구 시도) → closed
```

`open` 상태가 되면 해당 백엔드를 우선순위가 낮은 다른 백엔드로 자동 전환합니다. 대시보드 카드의 뱃지로 현재 상태를 확인할 수 있습니다.

## 역할 스킬

각 에이전트가 맡는 전문 역할입니다. 요청의 성격에 따라 적합한 역할이 자동으로 선택됩니다.

| 역할 | 전문 분야 | 위임 방향 |
|------|----------|----------|
| `butler` | 요청 수신 · 라우팅 · 단일 도구 실행 | → pm/pl/generalist |
| `pm` | 요구사항 분석 · 태스크 분해 | → implementer |
| `pl` | 기술 리드 · 아키텍처 설계 | → implementer/reviewer |
| `implementer` | 코드 작성 · 기능 구현 | — |
| `reviewer` | 코드 리뷰 · 품질 검증 | — |
| `debugger` | 버그 진단 · 근본 원인 분석 | — |
| `validator` | 출력 검증 · 회귀 테스트 | — |
| `generalist` | 범용 처리 | — |

### 역할 위임 흐름

```
사용자 메시지
  → butler (분류/라우팅)
      → 단순 질문/도구 실행: butler가 직접 처리
      → 복잡한 구현: pm → implementer → reviewer
      → 버그 수정: debugger → validator
      → 아키텍처 결정: pl → implementer
```

## 실행 모드

### Agent Loop (일반 대화)

메시지 → 에이전트 실행 → 응답의 단순 흐름입니다. 대부분의 요청이 이 모드로 처리됩니다.

### Task Loop (단계형 실행)

장기 작업을 단계로 나누어 실행하고, 각 단계마다 진행 상황을 보고합니다.

```
/task list              # 실행 중인 태스크 목록
/task cancel <id>       # 태스크 취소
```

## MCP 통합

Model Context Protocol 서버를 연결하면 에이전트가 외부 도구를 사용할 수 있습니다.

`workspace/mcp-servers.json`에 서버 목록을 정의하면 대시보드 → **Settings**에서 MCP를 활성화할 수 있습니다.

## 관련 문서

→ [채널 구조](./channels.md)
→ [스킬 시스템](./skills.md)
→ [프로바이더 설정 가이드](../guide/providers.md)
