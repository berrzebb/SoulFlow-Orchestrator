# 권장 사용법 및 모범 사례

이 가이드는 SoulFlow의 핵심 기능과 오케스트레이터를 최대한 활용하기 위한 권장 패턴을 다룹니다.

## 핵심 가치

SoulFlow는 단순한 챗봇 래퍼가 아닙니다. 다음을 가능하게 하는 **다중 에이전트 오케스트레이션 런타임**입니다:

1. **병렬 전문가 협업** + 품질 게이트
2. **시각적 워크플로우 자동화** — 6개 카테고리 141종 노드 타입
3. **샌드박스 실행** — 격리 컨테이너
4. **Human-in-the-Loop** — 채팅 채널 기반 워크플로우
5. **자동 복구** — 에러 분류 + 페일오버 체인

---

## 실행 모드

오케스트레이터 분류기가 각 요청에 최적의 실행 모드를 자동 선택합니다.

| 모드 | 트리거 | 동작 |
|------|--------|------|
| **once** | 단순 질문, 단일 도구 호출 | 단발 에이전트 응답 |
| **agent** | 다단계 작업, 복수 도구 | 도구 사이클의 Agent Loop |
| **task** | 장시간 실행, 체크포인트 기반 | 순차 단계의 Task Loop |
| **phase** | 다중 전문가 분석, 복잡한 프로젝트 | 병렬 에이전트 + 크리틱의 Phase Loop |

### 모드 선택 기준

- **once**: "도쿄 시간 알려줘" — 도구 불필요, 즉시 답변
- **agent**: "auth.ts에서 버그 찾아줘" — 파일 읽기, 분석, 응답
- **task**: "API 레이어 전체 리팩터링" — 다단계, 진행 추적
- **phase**: "AI 칩 시장 전체 조사" — 여러 전문가가 동시 작업 필요

분류기가 자동 처리합니다. 명시적 제어가 필요하면 Workflows 페이지 또는 WorkflowTool을 사용하세요.

---

## 다중 에이전트 Phase Loop

Phase Loop는 SoulFlow의 가장 강력한 실행 모델입니다. **페이즈 내 병렬 에이전트**를 실행하고, **크리틱 품질 게이트**를 거쳐 다음 페이즈로 진행합니다.

### Phase Loop 사용 시점

- 여러 관점이 필요한 작업 (리서치, 분석, 경쟁 리뷰)
- 뚜렷한 단계가 있는 프로젝트 (스펙 → 계획 → 구현 → 리뷰 → 검증)
- 품질 게이트가 중요한 상황 (크리틱이 승인해야 다음 단계 진행)

### 주요 기능

**에이전트별 대화**: 페이즈 내 각 에이전트가 독립 채팅 세션을 가집니다. 대시보드에서 에이전트 카드의 💬 버튼을 클릭하면 후속 질문이나 수정 요청이 가능합니다.

**에이전트 간 자율 통신**: 같은 페이즈의 에이전트가 `ask_agent`로 자율적으로 서로 질의할 수 있습니다. 예: 시장 분석가가 기술 분석가에게 공정 기술 데이터를 오케스트레이터 개입 없이 질문.

**크리틱 품질 게이트**: 모든 에이전트 완료 후 크리틱이 결과를 검토합니다. 거절 시 옵션:
- `retry_all` — 피드백과 함께 전체 에이전트 재실행
- `retry_targeted` — 지적된 에이전트만 재실행
- `escalate` — 사용자에게 결정 요청 (기본값, 가장 안전)
- `goto` — 특정 페이즈로 점프 (예: 수정 루프)

**실패 정책**: 페이즈별 에이전트 실패 처리 설정:
- `fail_fast` — 하나라도 실패하면 페이즈 중단
- `best_effort` — 가용한 결과로 계속 진행 (기본값)
- `quorum` — N개 이상 성공하면 진행

### 워크플로우 YAML 예시

```yaml
title: "시장 조사"
objective: "{{topic}}에 대한 종합 분석"

phases:
  - phase_id: research
    title: 데이터 수집
    agents:
      - role: 시장 분석가
        backend: openrouter
        model: claude-sonnet-4-20250514
        system_prompt: "시장 규모, 성장률, 트렌드를 분석합니다."
        tools: [web_search]
      - role: 기술 분석가
        backend: openrouter
        model: claude-sonnet-4-20250514
        system_prompt: "기술 스택, 특허, 기술 트렌드를 분석합니다."
        tools: [web_search]
    critic:
      backend: claude_sdk
      system_prompt: "논리적 일관성과 누락 데이터를 검토합니다."
      gate: true

  - phase_id: strategy
    title: 전략 종합
    context_template: |
      ## 이전 페이즈 결과
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - role: 전략가
        backend: claude_sdk
        system_prompt: "분석 결과를 실행 가능한 전략으로 종합합니다."
```

---

## Interactive & Sequential Loop 모드

병렬 실행 외에 Phase Loop는 페이즈별 두 가지 추가 모드를 지원합니다.

### Interactive 모드

단일 에이전트가 사용자와 대화하며 스펙을 공동 작성하거나 요구사항을 수집합니다.

```yaml
- phase_id: spec
  title: 스펙 작성
  mode: interactive
  max_loop_iterations: 20
  agents:
    - agent_id: spec-writer
      role: pm
      system_prompt: |
        대화를 통해 구현 스펙을 작성합니다.
        명확화 질문은 [ASK_USER]를 사용합니다.
        스펙이 완성되면 [SPEC_COMPLETE]를 출력합니다.
```

에이전트가 `[ASK_USER] 어떤 프레임워크를 선호하세요?`를 출력 → 사용자가 채팅 채널에서 응답 → 워크플로우가 답변과 함께 재개됩니다.

### Sequential Loop 모드

같은 에이전트가 반복마다 **fresh context**로 스폰되어, 긴 태스크 목록에서 컨텍스트 윈도우 오염을 방지합니다.

```yaml
- phase_id: implement
  title: 태스크 실행
  mode: sequential_loop
  max_loop_iterations: 50
  agents:
    - agent_id: implementer
      role: implementer
      system_prompt: |
        계획에서 다음 미완료 태스크를 실행합니다.
        막히면 [ASK_USER]로 사용자에게 질문합니다.
        모든 태스크 완료 시 [DONE]을 출력합니다.
      tools: [shell, file_request]
```

각 반복은 이전 반복의 누적 결과를 받지만 클린 컨텍스트 윈도우로 시작합니다.

---

## 시각적 워크플로우 DAG

그래프 에디터는 6개 카테고리(flow, data, AI, integration, interaction, advanced)의 141종 노드 타입을 지원합니다. 매 단계마다 LLM 추론이 필요 없는 결정적 자동화 파이프라인에 사용하세요.

### 권장 노드 조합

**데이터 파이프라인**: HTTP → Code (변환) → Template (포맷) → HTTP (웹훅)

**조건부 라우팅**: HTTP → IF (상태 확인) → LLM (성공 시) / Template (오류 알림)

**승인 워크플로우**: Form → Gate (승인) → LLM → Send-File

**정기 보고서**: Cron 트리거 → HTTP (데이터 수집) → LLM (분석) → Template (보고서) → Notify (Slack)

### WorkflowTool — 에이전트 기반 자동화

에이전트가 대시보드 없이 대화 중 워크플로우를 생성할 수 있습니다:

```
사용자: 매일 오후 6시에 GitHub PR 확인해서 Slack 요약 보내줘
에이전트: 워크플로우를 생성하겠습니다.
→ WorkflowTool { action: "create", name: "daily-pr-summary", definition: { ... } }
→ "daily-pr-summary를 18:00 크론 트리거로 생성했습니다."
```

사용 가능한 액션: `create`, `list`, `get`, `run`, `update`, `delete`, `export`.

---

## 컨테이너 샌드박스 실행

### Code 노드 언어

Code 노드는 JavaScript/Shell 외에 7개 컨테이너 기반 언어를 지원합니다:

| 언어 | 이미지 | 용도 |
|------|--------|------|
| Python | `python:3.12-slim` | 데이터 분석, ML 스크립트 |
| Ruby | `ruby:3.3-slim` | 텍스트 처리, 스크립팅 |
| Bash | `bash:5` | 시스템 자동화 |
| Go | `golang:1.22-alpine` | 성능 중요 로직 |
| Rust | `rust:1.77-slim` | 시스템 프로그래밍 |
| Deno | `denoland/deno:2.0` | 권한 기반 TypeScript |
| Bun | `oven/bun:1` | 빠른 TypeScript 실행 |

모든 컨테이너는 기본적으로 `--network=none`, `--read-only`, `--memory=256m`으로 실행됩니다. 외부 연결이 필요한 경우에만 `network_access: true`를 활성화하세요.

### 컨테이너 에이전트 격리

`container_cli` 백엔드를 사용하면 각 에이전트가 7계층 보안의 전용 Docker 컨테이너에서 실행됩니다:

1. **Gateway** — 분류기가 불필요한 스폰 방지
2. **AgentBus** — 통신 권한 매트릭스
3. **도구 필터링** — 역할 허용 도구만 노출
4. **파일시스템** — 볼륨 마운트 범위만 접근
5. **네트워크** — 기본 `network:none`
6. **리소스** — 메모리/CPU/PID 제한
7. **Docker 프록시** — API 화이트리스트 (컨테이너 전용)

---

## 자동 복구 및 복원력

SoulFlow는 사용자 개입 없이 자동으로 실패를 처리합니다.

### 에러 분류 파이프라인

| 에러 유형 | 복구 방법 |
|----------|----------|
| 컨텍스트 오버플로우 | 압축 (3회) → 도구 결과 잘라내기 → 포기 |
| 인증 에러 | 다음 인증 프로필로 로테이션 → 소진 시 모델 페일오버 |
| 레이트 리밋 | 지수 백오프 |
| 컨테이너 크래시 | 컨테이너 재스폰, 재시도 |
| 모델 불가용 | FailoverError → 외부 오케스트레이터가 모델 전환 |

### CircuitBreaker

각 프로바이더에 CircuitBreaker가 있어 건강 상태를 추적합니다. 반복 실패 시 백엔드가 자동 전환됩니다:
- `claude_sdk` → `claude_cli`
- `codex_appserver` → `codex_cli`

### 인증 프로필 로테이션

동일 프로바이더의 복수 API 키가 인증 에러 시 로테이션됩니다. 재시도 예산은 프로필 수에 비례하여 확장됩니다 (32~160회).

---

## 백엔드 선택 가이드

| 시나리오 | 권장 백엔드 |
|----------|-----------|
| 범용, 고품질 | `claude_sdk` |
| 코드 실행 샌드박스 필요 | `container_cli` |
| 비용 민감, 다량 요청 | `openai_compatible` (로컬 Ollama) |
| 100+ 모델 접근 | `openrouter` |
| Codex 전용 기능 | `codex_appserver` |
| 최대 격리 | `container_cli` (Docker 샌드박스) |

Providers 페이지에서 fallback 체인을 설정하세요. 오케스트레이터가 실패 시 자동 전환합니다.

---

## 워크플로우 설계 패턴

### 크리틱 기반 Goto (재시도 루프)

```yaml
- phase_id: validate
  critic:
    system_prompt: "모든 테스트 통과를 확인합니다."
    gate: true
    on_rejection: goto
    goto_phase: "fix"
    max_retries: 3
```

검증 실패 시 워크플로우가 수정 페이즈로 돌아간 뒤 재검증합니다. 3회 실패 후 사용자에게 에스컬레이션합니다.

### Fork-Join (병렬 분기)

```yaml
- phase_id: code-review
  depends_on: [implement]
  agents: [...]

- phase_id: security-review
  depends_on: [implement]
  agents: [...]

- phase_id: fix
  depends_on: [code-review, security-review]
  agents: [...]
```

`code-review`와 `security-review`가 병렬 실행됩니다. `fix`는 둘 다 완료를 대기합니다.

### 동적 워크플로우 생성

요청에 매칭되는 템플릿이 없으면 오케스트레이터가 자동 생성할 수 있습니다:

1. 분류기 반환: `{ mode: "phase", workflow_id: undefined }`
2. 매칭 템플릿 없음
3. 워크플로우 플래너 LLM이 `PhaseDefinition[]` 생성
4. 사용자에게 미리보기 표시 → 승인 후에만 실행

---

## 팁

- **단순하게 시작하세요**: 대부분의 작업에는 `once` / `agent` 모드를 사용하세요. Phase Loop는 진정으로 다중 관점이 필요한 작업에만 사용하세요.
- **크리틱 게이트 사용**: 프로덕션 워크플로우에서는 항상 크리틱에 `gate: true`를 설정하세요. 없으면 크리틱 피드백이 기록되지만 진행을 차단하지 않습니다.
- **긴 작업에 fresh context**: 태스크 목록이 10개를 초과하면 `sequential_loop` 모드를 사용하세요. 컨텍스트 오염은 품질을 크게 저하시킵니다.
- **워크스페이스 워크플로우**: 재사용 가능한 워크플로우를 `workspace/workflows/`에 YAML로 저장하세요. WorkflowTool의 `list` 액션에 표시되며 크론으로 트리거할 수 있습니다.
- **대시보드로 모니터링**: Workflows 페이지에서 실시간 페이즈 진행, 에이전트별 결과, 크리틱 리뷰를 확인하세요. 장시간 파이프라인 추적에 활용하세요.

## 관련 문서

→ [워크플로우 가이드](./workflows.md)
→ [대시보드 가이드](./dashboard.md)
→ [프로바이더 설정](./providers.md)
→ [설치 및 시작](../getting-started/installation.md)
