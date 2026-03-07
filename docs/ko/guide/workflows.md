# 워크플로우

워크플로우는 여러 AI 에이전트를 순차적 페이즈에 걸쳐 오케스트레이션합니다. 각 페이즈는 에이전트를 병렬로 실행하고, 선택적으로 critic 검토를 거친 후 다음 단계로 진행합니다. 이 가이드에서는 템플릿 작성, 실행 모드, 비주얼 에디터를 다룹니다.

## 빠른 시작

1. 대시보드 → **Workflows** 페이지 열기
2. **Templates** 탭 → **+ New** 또는 **Import** 클릭
3. 페이즈, 에이전트, critic 정의
4. **Run** 클릭 → 실시간으로 진행 상황 모니터링

또는 `workspace/workflows/`에 YAML 파일을 놓으면 자동으로 인식됩니다.

## 핵심 개념

### 페이즈

워크플로우는 **페이즈**의 시퀀스입니다. 각 페이즈에는 병렬로 실행되는 하나 이상의 에이전트와 선택적 critic 검토가 포함됩니다.

```
Phase 1: 조사              Phase 2: 전략
├─ [시장조사관]    ←         ├─ [전략가]
├─ [기술분석가]    ← 병렬    └─ [Critic] ← 게이트
└─ [Critic]       ← 게이트
```

### 에이전트

페이즈 내 각 에이전트는 다음을 가집니다:
- **역할**과 **레이블** — 정체성과 표시 이름
- **백엔드** — 사용할 AI 프로바이더 (예: `openrouter`, `claude_cli`)
- **시스템 프롬프트** — 에이전트에 대한 지시사항
- **도구** — 허용된 도구 이름 (예: `web_search`, `shell`)
- **최대 턴** — 대화 깊이 제한

### Critic

모든 에이전트 완료 후 선택적 품질 게이트. Critic은 모든 에이전트 출력을 검토하고 승인(→ 다음 페이즈) 또는 거절(→ 재시도/에스컬레이션)합니다.

---

## 템플릿 형식 (YAML)

템플릿은 `workspace/workflows/`에 YAML 파일로 저장됩니다.

### 최소 템플릿

```yaml
title: 시장 조사
objective: "{{topic}}에 대한 시장 분석"

phases:
  - phase_id: research
    title: 데이터 수집
    agents:
      - agent_id: analyst
        role: 시장조사관
        label: "시장조사관"
        backend: openrouter
        system_prompt: "시장 규모, 성장률, 트렌드를 분석하라."
        tools: [web_search]
        max_turns: 5
```

### 전체 템플릿

```yaml
title: 시장 조사
objective: "{{topic}}에 대한 종합 시장 분석"
variables:
  topic: "AI 인프라"

phases:
  - phase_id: research
    title: 데이터 수집
    mode: parallel                    # parallel | interactive | sequential_loop
    failure_policy: best_effort       # fail_fast | best_effort | quorum
    agents:
      - agent_id: market_analyst
        role: 시장조사관
        label: "시장조사관"
        backend: openrouter
        model: gpt-4o
        system_prompt: "시장 규모, 성장률, 트렌드를 분석하라."
        tools: [web_search]
        max_turns: 5

      - agent_id: tech_analyst
        role: 기술분석가
        label: "기술분석가"
        backend: claude_cli
        system_prompt: "기술 트렌드와 경쟁 구도를 분석하라."
        max_turns: 5

    critic:
      backend: openrouter
      system_prompt: "모든 분석의 논리적 일관성과 데이터 근거를 검토하라."
      gate: true                      # false = 피드백만, 차단 없음
      on_rejection: retry_targeted    # retry_all | retry_targeted | escalate | goto
      max_retries: 2

  - phase_id: strategy
    title: 전략 수립
    depends_on: [research]            # research 페이즈 완료 대기
    context_template: |
      ## 이전 조사 결과
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - agent_id: strategist
        role: 전략가
        label: "전략가"
        backend: openrouter
        system_prompt: "조사 결과를 바탕으로 비즈니스 전략을 수립하라."
```

### 변수

`objective` 및 기타 문자열 필드에서 `{{variable}}` 구문을 사용합니다. 런타임에 치환됩니다:

```yaml
objective: "{{region}} {{topic}} 심층 분석"
variables:
  topic: "EV 배터리"
  region: "동남아시아"
```

### 컨텍스트 템플릿

`context_template`으로 이전 페이즈 결과를 다음 페이즈에 전달합니다. 사용 가능한 변수:

| 변수 | 설명 |
|------|------|
| `prev_phase.agents` | 이전 페이즈의 에이전트 배열 |
| `this.label` | 에이전트 표시 레이블 |
| `this.result` | 에이전트 최종 출력 |
| `prev_phase.critic.review` | Critic 검토 텍스트 |

---

## 실행 모드

각 페이즈는 세 가지 모드 중 하나로 실행됩니다.

### Parallel (기본)

모든 에이전트가 동시에 실행됩니다. 전부 완료 후 결과를 수집합니다.

```yaml
- phase_id: research
  mode: parallel
  agents: [...]
```

### Interactive

단일 에이전트가 사용자와 대화하며 스펙을 공동 작성하거나 요구사항을 수집합니다. 에이전트는 마커로 흐름을 제어합니다:

| 마커 | 효과 |
|------|------|
| `[ASK_USER]` | 일시정지 후 사용자 채널로 질문 전송 |
| `[SPEC_COMPLETE]` | 페이즈 종료, 결과를 다음으로 전달 |

```yaml
- phase_id: spec
  mode: interactive
  max_loop_iterations: 20
  agents:
    - agent_id: spec-writer
      role: pm
      system_prompt: |
        대화를 통해 구현 스펙을 작성하라.
        [ASK_USER]로 명확화 질문을 하라.
        완료 시 [SPEC_COMPLETE]을 출력하라.
```

### Sequential Loop

같은 에이전트를 반복 생성하며 매번 새로운 컨텍스트를 제공합니다. 결과는 외부에 축적되어 컨텍스트 오염을 방지합니다.

| 마커 | 효과 |
|------|------|
| `[ASK_USER]` | 일시정지 후 사용자에게 질문 |
| `[DONE]` | 루프 종료 |

```yaml
- phase_id: implement
  mode: sequential_loop
  max_loop_iterations: 50
  agents:
    - agent_id: implementer
      role: implementer
      system_prompt: |
        다음 미완료 태스크를 실행하라.
        막히면 [ASK_USER]로 사용자에게 물어라.
        모든 태스크 완료 시 [DONE]을 출력하라.
      tools: [shell, file_request]
```

---

## 페이즈 분기

### 의존성 (Fork-Join)

페이즈는 `depends_on`으로 의존성을 선언할 수 있습니다. 같은 의존성을 가진 페이즈는 병렬 실행되며, 종속 페이즈는 모든 선행 조건이 완료될 때까지 대기합니다.

```yaml
- phase_id: code-review
  depends_on: [implement]
  agents: [...]

- phase_id: security-review
  depends_on: [implement]       # code-review와 병렬 실행
  agents: [...]

- phase_id: fix
  depends_on: [code-review, security-review]   # 둘 다 완료 대기
  agents: [...]
```

### Goto (Critic 롤백)

Critic이 거절하고 `on_rejection`이 `goto`이면 지정된 페이즈로 돌아갑니다:

```yaml
- phase_id: validate
  critic:
    system_prompt: "모든 테스트가 통과하는지 검증하라."
    gate: true
    on_rejection: goto
    goto_phase: fix             # fix 페이즈로 되돌아감
    max_retries: 3              # 최대 goto 루프 횟수
```

이를 통해 반복 개선 루프가 가능합니다:

```
implement → review → validate ──PASS──→ 완료
                       │
                      FAIL
                       ↓
                      fix → review → validate (재검증)
```

---

## 실패 정책

페이즈 내 에이전트 일부가 실패할 때의 동작을 per-phase로 설정합니다.

| 정책 | 동작 | 사용 사례 |
|------|------|----------|
| `fail_fast` | 하나라도 실패 → 즉시 실패 | 모든 결과 필수 |
| `best_effort` | 가능한 결과로 계속 진행 (기본) | 분석/조사 |
| `quorum` | N개 이상 성공 시 진행 | 투표/합의 |

```yaml
- phase_id: research
  failure_policy: quorum
  quorum_count: 2               # 최소 2개 성공 필요
```

## Critic 거절 전략

| 전략 | 동작 | 비용 |
|------|------|------|
| `retry_all` | 전체 에이전트 재실행 (critic 피드백 주입) | 높음 |
| `retry_targeted` | critic이 지목한 에이전트만 재실행 | 중간 |
| `escalate` | 사용자에게 결정 위임 — Continue / Retry / Abort (기본) | 없음 |
| `goto` | 지정된 페이즈로 이동 | 가변 |

---

## HITL (Human-in-the-Loop)

워크플로우는 여러 상황에서 사용자 입력을 위해 일시정지할 수 있습니다:

1. **Interactive 모드** — 에이전트가 `[ASK_USER]` 출력
2. **Sequential loop** — 에이전트가 `[ASK_USER]` 출력
3. **Critic 에스컬레이션** — critic이 `on_rejection: escalate`로 거절

일시정지 시 워크플로우 상태는 `waiting_user_input`이 됩니다. 사용자는 다음을 통해 응답할 수 있습니다:
- **대시보드** — 워크플로우 상세 페이지 채팅 패널
- **채널** — 원래 Slack/Telegram/Discord 채널

응답이 수신되면 워크플로우가 자동으로 재개됩니다.

---

## 그래프 에디터

SVG 기반 DAG 캔버스로 87종 노드 타입을 사용해 워크플로우를 설계합니다.

### 레이아웃

- **노드**는 페이즈 또는 오케스트레이션 노드를 나타내며, `depends_on` 기반 위상 레이어로 배치
- **실선 엣지** — 순차 흐름 / `depends_on` 의존성
- **점선 엣지** — `goto` 링크 (critic 롤백 점프)
- **모드 배지** — 각 노드에 실행 모드 표시 (∥ parallel, 🔄 interactive, 🔁 loop)
- **필드 포트** — 노드 간 메모리 기반 데이터 흐름을 위한 입출력 포트

### 노드 타입 (87종, 6개 카테고리)

| 카테고리 | 수량 | 노드 타입 |
|----------|------|----------|
| **Flow** | 13 | assert, batch, end, error-handler, filter, gate, if, loop, merge, retry, split, switch, wait |
| **Data** | 32 | aggregate, cache, code, crypto, data-format, date-calc, db, diff, encoding, eval, file, format, hash, jwt, lookup, markdown, math, media, memory-rw, queue, regex, secret-read, set, set-ops, stats, table, template, template-engine, text, transform, ttl-cache, validator |
| **AI** | 8 | ai-agent, analyzer, embedding, llm, retriever, spawn-agent, text-splitter, vector-store |
| **Integration** | 25 | archive, compress, database, docker, email, git, graphql, http, image, kanban-trigger, network, notify, oauth, package-manager, process, screenshot, send-file, shell, sub-workflow, system-info, web-form, web-scrape, web-search, web-table, webhook |
| **Interaction** | 4 | approval, escalation, form, hitl |
| **Advanced** | 5 | decision, diagram, promise, task, tool-invoke |

### 노드 인스펙터

노드를 클릭하면 **노드 인스펙터** 사이드 패널이 열립니다:
- **Parameters 탭** — 노드별 필드 편집 (타입 인식 입력, 드롭다운, 코드 에디터)
- **Output 탭** — 필드 스키마 및 출력 매핑 확인
- 드래그앤드롭으로 필드 포트 연결하여 데이터 흐름 구성

### 노드 피커

**노드 피커** 팔레트는 다음을 제공합니다:
- 카테고리별 노드 탐색 (flow, data, AI, integration, interaction, advanced)
- 키워드 검색
- 팔레트에서 캔버스로 드래그앤드롭
- 프리셋 템플릿 (예: Python CSV 처리, REST API 호출, LLM 체인)

### 인터랙션

| 동작 | 효과 |
|------|------|
| 노드 클릭 | 노드 인스펙터 사이드 패널 열기 |
| 노드 드래그 | 캔버스에서 위치 조정 |
| 노드 추가 | 노드 피커에서 드래그 또는 + 버튼 클릭 |
| 포트 연결 | 출력 포트에서 입력 포트로 드래그 |
| depends_on 설정 | 페이즈 노드 간 엣지 생성 |
| goto_phase 설정 | 점선 엣지 생성 |

### 빌더 탭

템플릿 에디터는 동기화된 세 가지 뷰를 제공합니다:

| 탭 | 설명 |
|----|------|
| **Graph** | SVG 기반 DAG 에디터 + 노드 인스펙터 |
| **Form** | 드롭다운과 입력 필드의 구조화된 폼 |
| **YAML** | 구문 강조가 적용된 원시 YAML 에디터 |

어느 탭에서든 변경하면 나머지 탭에 실시간으로 동기화됩니다.

---

## WorkflowTool (에이전트 기반 CRUD)

에이전트가 `workflow` 도구를 통해 워크플로우를 프로그래밍 방식으로 관리할 수 있습니다:

| 액션 | 설명 |
|------|------|
| `create` | YAML 정의로 새 워크플로우 생성 |
| `list` | 모든 워크플로우 템플릿 목록 |
| `get` | 이름으로 특정 템플릿 조회 |
| `run` | 변수 치환으로 워크플로우 실행 |
| `update` | 기존 템플릿 수정 |
| `delete` | 템플릿 삭제 |
| `export` | YAML로 템플릿 내보내기 |
| `node_types` | 사용 가능한 노드 타입 목록 (카테고리별 필터링) |

자연어로 워크플로우 관리가 가능합니다:
```
사용자: "분석가 3명이 참여하는 시장 조사 워크플로우 만들어줘"
→ 에이전트가 workflow 도구로 YAML 템플릿 생성 → 사용자 승인 후 실행
```

---

## 템플릿 관리

### 대시보드

- **Templates 탭** — 템플릿 목록, 생성, 편집, 삭제
- **Import** — YAML 붙여넣기 또는 파일 업로드
- **Run** — 빌더에서 직접 실행

### API

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/workflow-templates` | GET | 전체 템플릿 목록 |
| `/api/workflow-templates/:name` | GET | 단일 템플릿 조회 |
| `/api/workflow-templates/:name` | PUT | 템플릿 생성/수정 |
| `/api/workflow-templates/:name` | DELETE | 템플릿 삭제 |
| `/api/workflow-templates/import` | POST | YAML 텍스트에서 import |
| `/api/workflow-templates/:name/export` | GET | YAML로 export |

### 워크플로우 실행 API

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/workflows` | GET | 실행/완료된 워크플로우 목록 |
| `/api/workflows` | POST | 워크플로우 생성 및 실행 |
| `/api/workflows/:id` | GET | 워크플로우 상태 조회 |
| `/api/workflows/:id` | DELETE | 워크플로우 취소 |
| `/api/workflows/:id/resume` | POST | 일시정지된 워크플로우 재개 |
| `/api/workflows/:id/messages` | GET | 에이전트 대화 조회 |
| `/api/workflows/:id/messages` | POST | 에이전트에 메시지 전송 |
| `/api/workflow-roles` | GET | 역할 프리셋 목록 |

---

## 예제: 자율 개발 파이프라인

인간의 개발 프로세스를 미러링하는 6단계 워크플로우:

```yaml
title: 자율 개발 파이프라인
objective: "{{objective}}"

phases:
  - phase_id: spec
    title: 스펙 작성
    mode: interactive
    max_loop_iterations: 20
    agents:
      - agent_id: pm
        role: pm
        label: "PM"
        backend: claude_cli
        system_prompt: |
          대화를 통해 구현 스펙을 작성하라.
          [ASK_USER]로 명확화 질문을 하라.
          완료 시 [SPEC_COMPLETE]을 출력하라.

  - phase_id: plan
    title: 계획 수립
    depends_on: [spec]
    agents:
      - agent_id: pl
        role: pl
        label: "Tech Lead"
        backend: claude_cli
        system_prompt: "스펙을 번호가 매겨진 원자적 태스크로 분해하라."
    critic:
      backend: openrouter
      system_prompt: "계획의 완전성을 검토하라."
      gate: true

  - phase_id: implement
    title: 구현
    mode: sequential_loop
    max_loop_iterations: 50
    depends_on: [plan]
    agents:
      - agent_id: implementer
        role: implementer
        label: "구현자"
        backend: claude_cli
        system_prompt: |
          다음 태스크를 실행하라. 막히면 [ASK_USER]를 사용하라.
          모든 태스크 완료 시 [DONE]을 출력하라.
        tools: [shell, file_request]

  - phase_id: review
    title: 코드 리뷰
    depends_on: [implement]
    agents:
      - agent_id: reviewer
        role: reviewer
        label: "리뷰어"
        backend: openrouter
        system_prompt: "모든 변경사항의 정확성과 보안을 검토하라."

  - phase_id: fix
    title: 이슈 수정
    mode: sequential_loop
    depends_on: [review]
    agents:
      - agent_id: debugger
        role: debugger
        label: "디버거"
        backend: claude_cli
        system_prompt: |
          각 리뷰 이슈를 수정하라. 이슈가 없으면 [DONE]을 출력하라.
        tools: [shell, file_request]

  - phase_id: validate
    title: 검증
    depends_on: [fix]
    agents:
      - agent_id: validator
        role: validator
        label: "검증자"
        backend: claude_cli
        system_prompt: "빌드, 테스트, 타입 체크를 실행하라. 결과를 보고하라."
        tools: [shell]
    critic:
      backend: openrouter
      system_prompt: "모든 테스트가 통과하는지 검증하라."
      gate: true
      on_rejection: goto
      goto_phase: fix
      max_retries: 3
```

---

## 상태 영속성

워크플로우 상태는 매 페이즈 전환 시 SQLite(`workspace/runtime/workflows/phase-workflows.db`)에 저장됩니다. 이를 통해:

- **크래시 복구** — 재시작 후 마지막 완료된 페이즈부터 재개
- **HITL 일시정지** — 사용자 입력 대기 중 서버 재시작에도 워크플로우 유지
- **감사 추적** — 워크플로우별 전체 에이전트 대화 히스토리 보존

---

## 관련 문서

→ [대시보드](./dashboard.md)
→ [에이전트](../core-concepts/agents.md)
→ [보안](../core-concepts/security.md)
→ [프로바이더 설정](./providers.md)
