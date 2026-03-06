# 에이전트

SoulFlow의 에이전트 시스템은 두 계층으로 구성됩니다: **백엔드**(실행 엔진)와 **역할 스킬**(행동 지침). 오케스트레이션이 라이프사이클, 동시성, 안전성을 관리합니다.

## 에이전트 백엔드

메시지를 실제로 처리하는 실행 엔진입니다.

| 백엔드 | 방식 | 장점 | 자동 Fallback |
|--------|------|------|---------------|
| `claude_sdk` | 네이티브 SDK | 스트리밍, tool loop 내장 | → `claude_cli` |
| `claude_cli` | Headless CLI 래퍼 | 안정적, 범용 | — |
| `codex_appserver` | 네이티브 AppServer | 병렬 실행, tool loop 내장 | → `codex_cli` |
| `codex_cli` | Headless CLI 래퍼 | 샌드박스 모드 지원 | — |
| `gemini_cli` | Headless CLI 래퍼 | Gemini CLI 통합 | — |
| `openai_compatible` | OpenAI 호환 API | vLLM · Ollama · LM Studio · Together AI · Gemini 등 로컬/원격 모델 | — |
| `openrouter` | OpenRouter API | 멀티 모델 라우팅 · 100+ 모델 접근 | — |
| `container_cli` | 컨테이너 CLI 래퍼 | Docker/Podman 샌드박스 격리 실행 | — |

### 백엔드 선택 기준

- **스트리밍이 중요하다** → `claude_sdk` (가장 빠른 첫 응답)
- **안정성이 우선이다** → `claude_cli` (배치/프로덕션 환경)
- **Codex/OpenAI를 쓴다** → `codex_appserver` 또는 `codex_cli`
- **로컬/오픈소스 모델** → `openai_compatible` (vLLM, Ollama 등)
- **멀티 모델 접근** → `openrouter` (단일 API로 100+ 모델)
- **샌드박스 실행** → `container_cli` (Docker/Podman 격리)

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

### Once 모드 (단일 턴)

메시지 → 단일 에이전트 응답. 단순 질문과 직접 도구 호출에 사용됩니다. Temperature 0.3, 최대 1,600 토큰. 에이전트가 더 깊은 처리가 필요하다고 판단하면 agent 또는 task 루프로 에스컬레이션합니다.

### Agent Loop (멀티 턴)

연속적인 추론 + 도구 실행 루프. 에이전트가 작업 완료 또는 최대 턴(기본: 10) 도달까지 계속 작업합니다. 복잡한 추론을 위한 thinking 토큰(최대 16K)을 지원합니다.

### Task Loop (단계형 실행)

장기 작업을 명시적 단계로 분해: **계획 → 실행 → 완료**. 각 단계마다 진행 상황을 보고합니다. 기본 최대 40턴. 사용자 입력이나 승인을 위해 일시 정지 후 재개할 수 있습니다.

```
/task list              # 실행 중인 태스크 목록
/task cancel <id>       # 태스크 취소
```

### Phase Loop (워크플로우)

정의된 단계를 가진 멀티 에이전트 워크플로우. 각 단계에서 에이전트를 병렬 실행할 수 있습니다. 단계 간 크리틱 리뷰를 지원합니다.

## 서브에이전트 관리

작업에 병렬 처리나 위임이 필요할 때, 오케스트레이터가 서브에이전트를 생성합니다.

### 동시성

- **최대 10개** 동시 서브에이전트
- **최대 500개** 추적 레퍼런스 (완료된 오래된 것은 자동 정리)
- 각 서브에이전트는 독립적인 실행 컨텍스트와 도구 세트를 가짐

### 실행 모드

| 모드 | 용도 |
|------|------|
| Controller-Executor | 오케스트레이터 LLM이 턴 결정, executor가 실행 (기본값) |
| Direct Executor | Phase Loop용 단일 턴 실행 (`skip_controller`) |

### 캐스케이드 취소

부모를 취소하면 모든 자식 서브에이전트가 자동으로 취소됩니다. 이를 통해 고아 실행과 리소스 낭비를 방지합니다.

### 스트림 버퍼링

서브에이전트 출력은 버퍼링되어 **1.5초**마다 또는 버퍼가 **120자**를 초과할 때 플러시됩니다 — 레이트 리밋 스팸을 방지하면서 응답성을 유지합니다.

### 핸드오프

서브에이전트는 @멘션을 통해 태스크 라우팅을 알릴 수 있어, 전문화된 에이전트 간 작업 전달이 가능합니다.

## 승인 게이트

도구 실행을 사용자 승인 뒤에 게이팅할 수 있습니다. 자세한 내용은 [보안 — 승인 워크플로우](./security.md#5-승인-워크플로우-hitl)를 참조하세요.

서브에이전트 샌드박스 모드에서는 병렬 실행 차단을 방지하기 위해 승인이 자동으로 부여됩니다.

## 에이전트 Inspector

Inspector 서비스는 에이전트 런타임 상태를 조회하고 제어하기 위한 통합 API를 제공합니다.

### 기능

| 작업 | 설명 |
|------|------|
| `list_active_loops()` | 실행 중인 에이전트 루프 |
| `stop_loop(id, reason)` | 루프 정상 종료 |
| `list_runtime_tasks()` | 현재 실행 중인 태스크 |
| `list_stored_tasks()` | 저장된 태스크 히스토리 |
| `list_subagents()` | 생성된 서브에이전트와 상태 |
| `cancel_subagent(id)` | 특정 서브에이전트 취소 |
| `send_input_to_subagent(id, text)` | 실행 중인 서브에이전트에 입력 주입 |
| `list_approval_requests(status)` | 대기/해결된 승인 요청 |
| `resolve_approval_request(id, text)` | 사용자 결정 적용 |

### 대시보드 통합

모든 Inspector 작업은 웹 대시보드를 통해 노출되어 에이전트 활동, 태스크 진행 상황, 승인 큐에 대한 실시간 가시성을 제공합니다.

## 요청 분류

오케스트레이터 LLM이 수신 요청을 실행 모드로 분류합니다:

| 모드 | 선택 시점 |
|------|----------|
| `once` | 단순 질문, 직접 응답 |
| `agent` | 멀티 스텝 추론 필요 |
| `task` | 진행 추적이 필요한 장기 작업 |
| `inquiry` | 진행 전 명확화 필요 |
| `phase` | 멀티 에이전트 워크플로우 필요 |

Fallback: 오케스트레이터 LLM을 사용할 수 없는 경우 `once` 모드로 기본 설정됩니다.

## MCP 통합

Model Context Protocol 서버를 연결하면 에이전트가 외부 도구를 사용할 수 있습니다.

`workspace/mcp-servers.json`에 서버 목록을 정의하면 대시보드 → **Settings**에서 MCP를 활성화할 수 있습니다.

## 관련 문서

→ [보안](./security.md)
→ [채널 구조](./channels.md)
→ [스킬 시스템](./skills.md)
→ [프로바이더 설정 가이드](../guide/providers.md)
