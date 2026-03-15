# SoulFlow Orchestrator

[![CI](https://github.com/berrzebb/SoulFlow-Orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/berrzebb/SoulFlow-Orchestrator/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/berrzebb/SoulFlow-Orchestrator/gh-pages/badges/coverage.json)](https://github.com/berrzebb/SoulFlow-Orchestrator/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/berrzebb/SoulFlow-Orchestrator/gh-pages/badges/tests.json)](https://github.com/berrzebb/SoulFlow-Orchestrator/actions/workflows/ci.yml)
[![Lines of Code](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/berrzebb/SoulFlow-Orchestrator/gh-pages/badges/loc.json)](https://github.com/berrzebb/SoulFlow-Orchestrator)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.8-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

한국어 | [English](docs/README.en.md)

**어떤 LLM 프로바이더도 코드 한 줄 없이 교체할 수 있는** 클라우드 비종속 AI 에이전트 런타임.

Claude가 끊기면 Codex로, 비용이 부담되면 로컬 Ollama로 — CircuitBreaker가 자동 전환합니다.
Slack · Telegram · Discord · 웹 채팅의 메시지를 8개 역할 에이전트 팀이 처리하고,
민감정보는 AES-256-GCM Vault에 격리됩니다. **데이터는 내 서버에만 존재합니다.**

## 목차

- [설계 철학](#설계-철학)
- [두 가지 사용 경로](#두-가지-사용-경로)
- [구성 요소](#구성-요소)
- [아키텍처](#아키텍처)
- [빠른 시작](#빠른-시작)
- [대시보드](#대시보드)
- [OAuth 연동](#oauth-연동)
- [사용 예시](#사용-예시)
- [슬래시 커맨드](#슬래시-커맨드)
- [디렉터리 구조](#디렉터리-구조)
- [트러블슈팅](#트러블슈팅)

## 설계 철학

모든 세션 · 메모리 · 워크플로우 이력 · 칸반 데이터는 **로컬 SQLite**에 저장됩니다.

민감 업무는 Ollama(로컬)가 처리하고, 외부 정보가 필요할 때만 외부 LLM을 사용합니다. AES-256-GCM Vault가 인바운드 시점에 민감정보를 자동 sealing하고, 도구 실행 경로에서만 복호화를 허용합니다.

9개 에이전트 백엔드는 CircuitBreaker가 자동 관리합니다 — 코드 수정 없이 프로바이더 교체, 완전 로컬(Ollama only) 운영 모두 가능합니다.

## 두 가지 사용 경로

SoulFlow는 두 가지 독립적인 경로로 사용할 수 있습니다.

### 경로 A — 오케스트레이터 (채널 기반)

Slack · Telegram · Discord · 웹 채팅 메시지를 수신해 **8개 역할 에이전트 팀**이 자율 처리합니다. 자연어로 워크플로우를 설명하면 AI가 DAG를 생성하고, HITL(사람 개입) 게이트에서 승인 후 실행합니다.

```
채널 메시지 → 분류 → 에이전트 팀 실행 → 스트리밍 응답
                ↓
           워크플로우 엔진 (141종 노드 · DAG)
                ↓
           188개 도구 팔레트 (결정론적) + 에이전트 (LLM)
```

### 경로 B — MCP 서버 브리지 (IDE 연동)

**`mcp-soulflow.ts`** 를 Claude Code · Cursor 등 MCP 호환 AI 도구에 연결하면, IDE 안에서 SoulFlow의 프로젝트 관리 인프라를 직접 호출합니다. 오케스트레이터를 실행하지 않아도 됩니다.

```jsonc
// .claude/settings.local.json
{
  "mcpServers": {
    "soulflow": {
      "command": "npx",
      "args": ["tsx", "mcp-soulflow.ts"]
    }
  }
}
```

연결 후 사용 가능한 도구 (56개):

| 카테고리 | 도구 예시 |
|---------|---------|
| **칸반** | `kanban_create_board` · `kanban_create_card` · `kanban_move_card` · `kanban_board_metrics` |
| **워크플로우** | `workflow_list_templates` · `workflow_create_template` · `workflow_list_runs` |
| **런타임 DB** | `runtime_query` · `session_history` · `cron_status` · `memory_search` |
| **i18n** | `i18n_search` · `i18n_upsert` |
| **프로젝트** | `project_tree` · `node_catalog` · `docs_search` · `project_list_agents` |
| **레퍼런스** | `reference_search` · `reference_add` · `reference_sync` |

## 구성 요소

| 구성 요소 | 역할 | 핵심 특징 |
|----------|------|----------|
| **보안 Vault** | AES-256-GCM 민감정보 관리 | 인바운드 자동 sealing · 도구 경로 복호화만 허용 |
| **에이전트 백엔드** | 9종 LLM 실행 엔진 | CircuitBreaker · HealthScorer · 자동 fallback · Ollama 로컬 지원 |
| **워크플로우 엔진** | Phase Loop · DAG 실행 | 141종 노드 그래프 에디터 · 6개 카테고리 · HITL 인터랙션 노드 |
| **도구 팔레트** | 188개 결정론적 도구 | 파일 · 웹 · DB · AI/ML · 인프라 · SoulFlow 런타임 전 카테고리 |
| **역할 스킬** | 8개 역할 계층적 분담 | concierge → pm/pl → implementer/reviewer/validator/debugger · diagram · github · sandbox |
| **채널 매니저** | Slack · Telegram · Discord 수신/응답 | 스트리밍 · 그룹핑 · 페르소나 톤 렌더링 |
| **오케스트레이터** | 인바운드 → 에이전트 실행 | Agent Loop · Task Loop · Phase Loop 삼중 모드 |
| **MCP 서버 브리지** | Claude Code · Cursor 등 AI 개발 도구 연동 | 56개 프로젝트 관리 도구 MCP 노출 |
| **도메인 서비스** | 임베딩 · 벡터 스토어 · 웹훅 · 칸반 · 레퍼런스 스토어 | sqlite-vec KNN · 하이브리드 검색 · 칸반 자동화 규칙 |
| **평가 파이프라인** | 에이전트 출력 품질 평가 | EvalCase · EvalRunner · judge · scorer · 프로바이더 비교 |
| **대시보드** | 웹 기반 실시간 모니터링 | SSE 피드 · 에이전트/태스크/결정/프로바이더 관리 |
| **MCP 클라이언트** | 외부 도구 서버 연결 | stdio/SSE · 자동 CLI 주입 |
| **메시지 버스** | 내부 이벤트 라우팅 | 인메모리 (기본) · Redis Streams (다중 인스턴스) |
| **OAuth 연동** | 외부 서비스 인증 | GitHub · Google · Custom OAuth 2.0 |
| **크론** | 정기 작업 스케줄 | SQLite 기반 · 핫 리로드 |

### 에이전트 백엔드

`claude_sdk` · `claude_cli` · `codex_appserver` · `codex_cli` · `gemini_cli` · `openai_compatible` · `openrouter` · `ollama` · `container_cli` — CircuitBreaker · 자동 fallback.

→ [에이전트 백엔드 선택 가이드](docs/ko/core-concepts/agents.md)

### 역할 스킬 & 팀 구성

8개 역할이 계층적으로 협업합니다. `concierge`가 사용자를 직접 대면하고, 개발 작업은 `pm`/`pl`을 통해 전문 역할에 위임합니다.

```
concierge (사용자 대면)
  ├── pm (기획) → pl (실행 조율)
  └── pl (즉시 실행)
        ├── implementer · reviewer · validator · debugger
        └── generalist
```

| 팀 프리셋 | 구성 | 용도 |
|----------|------|------|
| **풀 팀** | PM → PL → Implementer → Reviewer → Validator | 복잡한 개발 작업 |
| **라이트** | PM → Implementer → Validator | 소규모·명확한 작업 |
| **기획팀** | PM | 계획 수립 · 문서화 |
| **품질관리팀** | Reviewer + Implementer | 코드 리뷰 · 구조 개선 |
| **테스트팀** | Validator | 빌드 · 테스트 · lint |

### 도구 & 스킬 동적 선택

174개 도구 전체 전송 시 ~25,000 토큰 소비. **ToolIndex FTS5**가 한/영 키워드 확장 + BM25 랭킹으로 요청별 최적 도구 20~35개를 자동 선택합니다. (Core 13개 항상 포함)

## 아키텍처

```mermaid
flowchart TD
    subgraph Channels["채널 입력"]
        direction LR
        SL[Slack]
        TG[Telegram]
        DS[Discord]
        WEB[Web Chat]
    end

    subgraph Security["보안 경계"]
        direction TB
        WHOOK[웹훅 엣지 가드\n서명 검증 · SSRF 차단 · 재전송 방지]
        SEAL[민감정보 Sealing · AES-256-GCM]
        EGRS[토큰 Egress 가드\n출력 시크릿 재밀봉]
    end

    subgraph Pipeline["처리 파이프라인"]
        direction TB
        CMD[슬래시 커맨드 · 가드 · 21종 핸들러]
        NGRD[Ingress 정규화\n채널 중립 · 멘션 제거]
        ORCH[오케스트레이터 · 분류기 · ToolIndex FTS5/BM25]
        GW[Gateway 계약\nRequestPlan · ResultEnvelope · CostTier]
    end

    subgraph Backends["에이전트 백엔드 (9)"]
        direction LR
        CSDK[claude_sdk]
        CCLI[claude_cli]
        CAPPS[codex_appserver]
        CCLIX[codex_cli]
        GCLI[gemini_cli]
        OAI[openai_compatible]
        ORT[openrouter]
        OLL[ollama]
        CTR[container_cli]
    end

    subgraph PTY["PTY / Docker 격리"]
        direction LR
        POOL[ContainerPool]
        BUS[AgentBus]
        BRIDGE[MCP 브릿지]
    end

    subgraph Workflows["워크플로우 엔진"]
        direction TB
        PL[Phase Loop · Agent/Task Loop]
        DAG[DAG 실행기 · 141종 노드]
        INTERACT[인터랙션 · HITL · 승인 · 폼]
    end

    subgraph Skills["역할 스킬 (8역할 + 19빌트인)"]
        direction TB
        BT[concierge]
        PM[pm · pl]
        IMPL[implementer · reviewer]
        DBG[debugger · validator]
        BSKILL[diagram · github · sandbox · ...]
    end

    subgraph Services["도메인 서비스"]
        direction LR
        EMBED[Embed · VectorStore · sqlite-vec]
        WEBHOOK[Webhook · Task · Kanban]
        CATALOG[ModelCatalog · ReferenceStore]
    end

    subgraph Evals["평가 파이프라인"]
        direction LR
        ERUN[EvalRunner · bundles]
        EJUDGE[judge · scorer · Scorecard]
    end

    subgraph Observability["관찰성"]
        direction LR
        SPANS[실행 스팬 · 메트릭 싱크]
        TRACE[전달 추적 · DLQ]
    end

    DASH[대시보드 · OAuth · SSE · i18n]

    Channels --> Security
    Security --> Pipeline
    Pipeline --> GW
    GW --> Backends
    GW --> Workflows
    GW --> Evals
    Workflows --> Backends
    Evals --> Backends
    INTERACT -.->|ASK_USER · 승인| Channels
    CTR --> PTY
    Backends --> Skills
    Skills --> EGRS
    EGRS --> OUT([응답 · 스트리밍])
    Workflows --> Services
    DASH -.-> Pipeline
    Backends -.->|spans/metrics| Observability
    Pipeline -.->|이벤트| Observability
```

**인바운드 파이프라인**

```mermaid
flowchart LR
  WHOOK["웹훅 엣지 가드\n서명 검증 · SSRF · 재전송 방지"]
  CH["채널 read()"]
  DD{"중복 체크"}
  CMD{"CommandRouter\n슬래시 커맨드 + 퍼지 매칭"}
  GUARD["ConfirmationGuard"]
  APR["ApprovalService"]
  SEAL["Sensitive Seal\nAES-256-GCM"]
  MEDIA["MediaCollector"]
  NGRD["Ingress 정규화\n채널 중립 · 멘션 제거"]
  ORCH["OrchestrationService\nonce · agent · task · phase\nFTS5/BM25 ToolIndex"]
  BACK["AgentBackend\n가드레일 · 예산 계약"]
  TOOL["도구 실행 + 시크릿 복호화"]
  REC["SessionRecorder + 스팬"]
  DISP["DispatchService"]
  EGRS["토큰 Egress 가드"]
  OUT["채널 send()"]

  WHOOK --> CH
  CH --> DD
  DD -->|신규| CMD
  DD -->|중복| X(skip)
  CMD -->|슬래시 커맨드| DISP
  CMD -->|메시지| GUARD
  GUARD -->|위험 작업| APR
  GUARD -->|일반| SEAL
  APR -->|승인 완료| SEAL
  SEAL --> MEDIA --> NGRD --> ORCH
  ORCH --> BACK
  BACK -->|tool_calls| TOOL
  TOOL -->|result| BACK
  BACK --> REC --> DISP --> EGRS --> OUT
```

**역할 위임 계층**

```mermaid
flowchart TD
  USER["사용자 메시지"]
  CON["🏠 concierge\n사용자 대면 · 일상 처리 · 위임 조율"]
  PM["📋 pm\n요구사항 분석 · 스펙 작성"]
  PL["🔧 pl\n실행 조율 · Phase Gate"]
  IMPL["⚡ implementer\n코드 구현 · 셀프 검증"]
  REV["🔍 reviewer\n품질 · 보안 · 성능"]
  VAL["✅ validator\n빌드 · 테스트 · lint"]
  DBG["🐛 debugger\nRCA · 수정 제안"]
  GEN["🔄 generalist\n범용 단일 작업"]

  USER --> CON
  CON -->|기획 필요| PM -->|스펙 전달| PL
  CON -->|즉시 실행| PL
  PL -->|구현| IMPL
  PL -->|리뷰| REV
  PL -->|검증| VAL
  PL -->|디버깅| DBG
  PL -->|잡무| GEN
  IMPL & REV & VAL -->|결과| PL
```

## 빠른 시작

### 요구사항

- **Docker** 또는 **Podman**
- AI 프로바이더 API 키 (Claude, OpenAI, OpenRouter 등)
- (선택) 채널 Bot Token (Slack · Telegram · Discord) — 없으면 Web 채널로 바로 사용

### 시작

```bash
git clone https://github.com/berrzebb/SoulFlow-Orchestrator.git
cd SoulFlow-Orchestrator

# Linux/macOS
./run.sh prod --workspace=/path/to/workspace

# Windows
.\run.ps1 prod --workspace=D:\workspace
```

브라우저에서 `http://localhost:4200` 열고 **Setup Wizard**를 완료하면 끝입니다.

> 상세: [설치 가이드](docs/ko/getting-started/installation.md) — 개발/스테이징/다중 인스턴스, 에이전트 로그인, Docker Compose 직접 사용

---

## 대시보드

`http://127.0.0.1:4200` — React + Vite SPA. 한국어/영어 i18n 지원 (브라우저 로케일 자동 감지).

| 페이지 | 경로 | 기능 |
|--------|------|------|
| Overview | `/` | 런타임 상태 요약, 시스템 메트릭, SSE 실시간 피드 |
| Chat | `/chat` | 웹 기반 에이전트 대화 (마크다운 렌더링 + 코드 하이라이팅) |
| **Prompting** | `/prompting` | 프롬프팅 스튜디오 · Text/Image/Video 생성 · 에이전트 설계·테스트 · Gallery · A/B 비교 |
| Workspace | `/workspace` | 메모리 · 세션 · 스킬 · 크론 · 도구 · 에이전트 · 템플릿 · OAuth · 모델 · 레퍼런스 (10탭) |
| Channels | `/channels` | 채널 연결 상태 · 글로벌 설정 |
| Providers | `/providers` | 에이전트 프로바이더 CRUD · Circuit Breaker 상태 |
| Secrets | `/secrets` | AES-256-GCM 시크릿 관리 |
| Workflows | `/workflows` | Phase Loop 워크플로우 관리 · 141종 노드 그래프 에디터 · 에이전트 채팅 |
| Kanban | `/kanban` | 드래그앤드롭 칸반 보드 · 자동화 규칙 |
| WBS | `/wbs` | 칸반 카드 계층 트리 뷰 (parent_id 기반) |
| Admin | `/admin` | 관리자 콘솔 · 팀/사용자 관리 · 채널 인스턴스 현황 |
| Settings | `/settings` | 글로벌 런타임 설정 |

→ 상세: [대시보드 가이드](docs/ko/guide/dashboard.md)

### 스크린샷

<details open>
<summary><strong>대시보드 개요</strong></summary>

![Overview](docs/images/overview.png)
![Workflows](docs/images/workflows.png)
![Chat](docs/images/chat.png)

</details>

<details>
<summary><strong>웹 채팅 — Concierge 에이전트</strong></summary>

코드베이스를 직접 읽고, clarification-protocol로 구체적 응답을 보장하며, 리치 미디어(지도·테이블)를 채팅 안에 임베드합니다.

**Concierge 분석 응답** — "사용자 알림 시스템 추가" 요청에 코드베이스 분석 → 4가지 결정 프레임워크 → MVP 범위 → Notification 데이터 모델

![Chat Concierge Response](docs/images/chat-concierge-response.png)
![Chat Concierge Analysis](docs/images/chat-concierge-analysis.png)

**구현 로드맵** — 6단계 구현 순서 + "비즈니스 이벤트"/"알림 전송" 분리 원칙 + chase-gates 다음 액션 제안

![Chat Concierge Implementation](docs/images/chat-concierge-implementation.png)

**리치 미디어 렌더링** — Leaflet.js 인터랙티브 지도를 채팅 버블 안에 임베드

![Chat Concierge Map](docs/images/chat-concierge-map.png)

**도구 실행 결과** — 8개 도구 병렬 실행 → 맛집 4곳 추천 + 미쉐린·식신·테이블링 출처 URL

![Chat Concierge Restaurant](docs/images/chat-concierge-restaurant.png)

**지도 Fallback** — Nominatim 실패 시 Google Maps iframe 자동 전환 (에이전트 변경 없이 도구 레이어에서 graceful degradation)

![Chat Map Iframe Fallback](docs/images/chat-map-iframe-fallback.png)

</details>

<details>
<summary><strong>워크플로우 에디터</strong> — 141종 노드 · YAML/DAG/Seq 3뷰 동기화</summary>

**자연어 → 멀티에이전트 플로우 자동 생성**

![Workflow Editor Generated](docs/images/workflow-editor-generated.png)

**YAML + DAG 동기화 뷰**

![Workflow Editor YAML+DAG Split](docs/images/workflow-editor-yaml-dag-split.png)

**DAG 전체 조감도** — Phase + IF 분기 + Merge + Filter 노드 체인

![Workflow Editor DAG Full](docs/images/workflow-editor-dag-full.png)
![Workflow Editor IF Branch](docs/images/workflow-editor-dag-if-branch.png)

**노드 인스펙터** — Execution Mode · Failure Policy · Agent · Critic 통합 설정

![Workflow Editor Node Inspector](docs/images/workflow-editor-node-inspector.png)
![Workflow Editor Agent Roles](docs/images/workflow-editor-agent-roles.png)

**정책 설정** — Failure Policy (Best Effort / Fail Fast / Quorum) · Critic Gate (Retry All / Retry Targeted / Escalate / Goto Phase)

![Workflow Editor Failure Policy](docs/images/workflow-editor-failure-policy.png)
![Workflow Editor Critic Config](docs/images/workflow-editor-critic-config.png)

**트리거 · 도구** — Kanban Trigger (6개 OUTPUT 파라미터) · Tool/Skill 팔레트 (188개)

![Workflow Editor Kanban Trigger](docs/images/workflow-editor-kanban-trigger.png)
![Workflow Editor Tool Palette](docs/images/workflow-editor-tool-palette.png)

</details>

<details>
<summary><strong>워크플로우 실행 · 패턴</strong></summary>

**라이브 실행** — Phase별 에이전트 진행 상태 + 인라인 에이전트 채팅

![Workflow Running Live](docs/images/workflow-running-live.png)
![Workflow Agent Chat](docs/images/workflow-agent-chat.png)

**Kanban × Workflow 연동** — `kanban_event` 트리거가 멀티에이전트 파이프라인 구동

![Workflow Kanban Integration](docs/images/workflow-kanban-integration.png)
![Workflow Kanban Node Inspector](docs/images/workflow-kanban-node-inspector.png)

**spec-driven-dev (Phase Loop)** — Research → Spec → Kanban Planning → Implementation → Validation · Seq 뷰에서 Mermaid 다이어그램 자동 생성

![Workflow Spec Driven Dev](docs/images/workflow-spec-driven-dev.png)
![Workflow Seq Auto Gen](docs/images/workflow-seq-auto-gen.png)
![Workflow Spec Driven Dev Full](docs/images/workflow-spec-driven-dev-full.png)

**autonomous-dev-pipeline (Interactive Loop)** — Objective 하나로 전체 개발 사이클 자율 완결

> PM/Spec Writer(**Interactive** · MAX ITERATIONS 20) → 요구사항 디깅 → 설계 문서
> → PL 칸반 태스크 분해 → Implementer → Reviewer (Done/TODO) → Fixer → Validator

![Workflow Autonomous Dev Pipeline](docs/images/workflow-autonomous-dev-pipeline.png)

</details>

<details>
<summary><strong>Prompting Studio</strong> — Text · Image · Video · Agent · Gallery · Compare</summary>

![Prompting](docs/images/prompting.png)

**Compare** — 동일 프롬프트를 최대 6개 모델에 동시 실행 · 응답 품질 나란히 비교

![Prompting Compare](docs/images/prompting-compare.png)

**Agent Gallery** — 8종 빌트인 에이전트 · Use/Fork로 즉시 사용 또는 커스터마이징

![Prompting Agent Gallery](docs/images/prompting-agent-gallery.png)

**Agent Design** — 에이전트를 **구조화된 계약서**로 정의: SOUL(정체성) + HEART(행동) + SHARED PROTOCOLS + BOUNDARY("Do NOT use for Y") + AI GENERATE

![Prompting Agent Design](docs/images/prompting-agent-design.png)

</details>

<details>
<summary><strong>Kanban 3뷰</strong> — Board · List · WBS 동일 데이터소스 연동</summary>

**Board 뷰** — 드래그앤드롭 + 자동화 규칙

![Kanban](docs/images/kanban.png)
![Kanban Rules](docs/images/kanban-rules.png)
![Kanban Rule Editor](docs/images/kanban-rule-editor.png)

**Kanban × Agent** — AI 에이전트가 팀원처럼 카드 분석·이동·코멘트

![Kanban Agent Contributor](docs/images/kanban-agent-contributor.png)

**List 뷰** — 카드 상세(SUBTASKS · 라벨 · 코멘트) 인라인 패널

![Kanban List](docs/images/kanban-list.png)

**WBS 뷰** — 작업분류체계 번호 · Progress 롤업

> Board · List · WBS 3개 뷰 + 워크플로우 Kanban Trigger가 모두 같은 데이터소스 — 카드 상태 하나가 3개 뷰 + 워크플로우에 즉시 반영

![WBS](docs/images/wbs.png)

</details>

<details>
<summary><strong>Workspace · System · Admin</strong></summary>

**Workspace** — 세션 · 스킬 · 도구 · 템플릿 · OAuth 10탭 관리

![Workspace Sessions](docs/images/workspace-sessions.png)
![Workspace Tools](docs/images/workspace-tools.png)
![Workspace Templates](docs/images/workspace-templates.png)
![Workspace OAuth](docs/images/workspace-oauth.png)
![Workspace Skills](docs/images/workspace-skills.png)

**Secrets · Channels · Providers · Settings**

![Secrets](docs/images/secrets.png)
![Channels](docs/images/channels.png)
![Providers](docs/images/providers.png)
![Providers Chat Models](docs/images/providers-chat-models.png)
![Settings](docs/images/settings.png)

**Admin Console** — 팀/사용자 관리 · 글로벌 모니터링

![Admin Monitoring](docs/images/admin-monitoring.png)

</details>

## Kanban × Workflow 자율 실행 루프

Kanban 보드 · 워크플로우 엔진 · 멀티에이전트가 단일 폐루프를 형성합니다.
카드 상태 변경 하나가 3개 뷰에 즉시 반영되고, 동시에 에이전트 파이프라인의 트리거 이벤트가 됩니다.

```mermaid
sequenceDiagram
    actor User as 사용자 / Slack
    participant WF  as 워크플로우 엔진
    participant P1  as Phase-1<br/>(pm · pl)
    participant KB  as Kanban API
    participant P2  as Phase-2<br/>(Critic · implementer<br/>reviewer · validator)

    User->>WF: 메시지 전송 (channel_mess trigger)
    WF->>P1: Phase-1 시작 — 저장소 입력 검증
    P1->>KB: 칸반 보드 초기화 · 카드 생성 (TODO)
    KB-->>WF: kanban_event (card_created)

    WF->>P2: Phase-2 시작 — 작업 실행
    P2->>KB: 카드 → In Progress 이동
    KB-->>WF: kanban_event (card_moved)

    loop 구현 → 리뷰 사이클
        P2->>P2: implementer 구현 · reviewer 검토
        P2->>KB: 서브태스크 생성 · 코멘트 추가
        P2->>KB: 카드 → Review 이동
        KB-->>WF: kanban_event (card_moved)
        WF->>P2: Phase-2 재진입 — validator 검증
    end

    P2->>KB: 카드 → Done 이동
    KB-->>User: 완료 알림 (채널 메시지)
```

## OAuth 연동

GitHub · Google · Custom OAuth 2.0 외부 서비스 연동. 대시보드 Workspace → OAuth 탭에서 관리합니다.

에이전트 도구에서 `oauth:{instance_id}` 참조로 토큰 자동 주입, 401 시 자동 갱신 재시도.

→ 상세: [OAuth 가이드](docs/ko/guide/oauth.md)

---

## 사용 예시

**단순 작업** (concierge → 자동 역할 분배):

```
사용자: 이 코드에서 버그 찾아줘
→ concierge → debugger 활성화 → 근본 원인 분석 → 응답
```

**태스크 실행** (단계형 실행/승인):

```
사용자: /task list
→ 실행 중인 태스크 목록 반환

사용자: 사용자 인증 API 구현해줘
→ pm 기획 → pl 설계 → implementer 구현 → reviewer 검토
```

**민감정보 관리**:

```
사용자: /secret set MY_API_KEY sk-abc123
→ AES-256-GCM 암호화 저장

사용자: MY_API_KEY로 API 호출해줘
→ 도구 실행 시 자동 복호화 (에이전트에는 참조만 전달)
```

**실시간 스트리밍**:

```
사용자: 복잡한 분석 요청
→ agent 사고 중... (typing 갱신)
→ 부분 응답 점진적 전송
→ 최종 응답
```

**슬래시 커맨드 제어**:

```
/stop          → 현재 채널 작업 즉시 중지
/status        → 런타임 상태 · 도구 · 스킬 목록
/reload skills → 스킬 핫 리로드 (재시작 없음)
/doctor        → 서비스 건강 상태 자가진단
```

## 슬래시 커맨드

자주 쓰는 커맨드:

| 커맨드 | 설명 |
|--------|------|
| `/help` | 공통 명령/사용법 출력 |
| `/stop` · `/cancel` · `/중지` | 현재 채널 활성 작업 중지 |
| `/status` | 런타임 상태 요약 (도구·스킬 목록 포함) |
| `/secret set\|get\|list\|reveal\|remove` | AES-256-GCM secret vault 관리 |
| `/task list\|cancel <id>` | 프로세스·작업 조회/취소 |
| `/agent list\|cancel\|send` | 서브에이전트 목록/취소/입력 전송 |
| `/reload config\|tools\|skills` | 설정/도구/스킬 핫 리로드 |
| `/doctor` | 런타임 자가진단 (서비스 건강 상태 점검) |
| `/workflow list\|create\|cancel <id>` | Phase Loop 워크플로우 관리 |
| `/mcp list\|reconnect <name>` | MCP 서버 상태/재연결 |

→ [전체 커맨드 참조](docs/ko/guide/slash-commands.md)

## 디렉터리 구조

```text
next/
  run.sh / run.ps1 / run.cmd ← 환경 관리 (dev/test/staging/prod)
  Dockerfile              ← 멀티스테이지 Docker 빌드
  .devcontainer/          ← VS Code Dev Container 설정
  docker/                 ← docker-compose 파일 (prod, dev, instance 오버라이드)
  src/
    agent/
      backends/     ← SDK/AppServer/OpenAI 백엔드 어댑터
      nodes/        ← 141종 워크플로우 노드 핸들러 (OCP 플러그인 아키텍처)
      pty/          ← PTY 기반 CLI 통합 (ContainerPool, AgentBus, NDJSON 와이어)
      tools/        ← 에이전트 도구 구현 (oauth_fetch, workflow, ask-user 등)
    bootstrap/      ← 15개 부트스트랩 모듈 (main.ts 분해)
    bus/            ← MessageBus (인메모리 · Redis Streams)
    channels/       ← 채널 매니저 · 커맨드 · 디스패치 · 승인 · 페르소나 톤
    config/         ← Zod 기반 설정 스키마
    cron/           ← 크론 스케줄러 (SQLite)
    dashboard/
      ops/          ← 13개 ops 모듈
      routes/       ← 라우트 핸들러
    decision/       ← 결정사항 서비스
    evals/          ← 평가 파이프라인 (EvalRunner, EvalCase, judges, scorers, bundles)
    evals/          ← 평가 파이프라인 (EvalCase · EvalRunner · judge · scorer · bundles)
    events/         ← 워크플로우 이벤트 서비스
    heartbeat/      ← 하트비트 서비스
    i18n/           ← 공유 i18n 프로토콜 + JSON 로케일
    mcp/            ← MCP 클라이언트 매니저
    oauth/          ← OAuth 2.0 연동 (flow-service, integration-store)
    orchestration/  ← Classifier · ToolIndex · ConfirmationGuard · HitlPendingStore
    providers/      ← LLM 프로바이더 (Claude, Codex, Gemini, OpenAI-compatible)
    runtime/        ← 인스턴스 잠금 · ServiceManager
    security/       ← Secret Vault (AES-256-GCM)
    services/       ← 도메인 서비스 (embed, vector-store, kanban, webhook, model-catalog 등)
    session/        ← 세션 저장소
    skills/
      _shared/      ← 공유 프로토콜
      roles/        ← 8개 역할 (concierge, pm, pl, implementer, reviewer, validator, debugger, generalist)
      diagram / github / sandbox / ...  ← 추가 빌트인 스킬
  scripts/
    scaffold/       ← 코드 생성기 (tool, node, handler, route, page)
    generate-diagrams.mjs ← SVG 다이어그램 생성
    i18n-sync.ts    ← i18n 키 동기화 (--check / --fix)
  tests/
    evals/          ← 평가 테스트 케이스 (cases/*.json) 및 executor 테스트
  <workspace>/      ← --workspace 로 지정 (런타임 데이터)
    runtime/        ← SQLite DB (sessions, tasks, events, cron, kanban, dlq 등)
    skills/         ← 사용자 정의 스킬
    templates/      ← 시스템 프롬프트 템플릿
  web/              ← 대시보드 프론트엔드 (React + Vite + i18n)
    src/pages/workflows/  ← 그래프 에디터 · 노드 인스펙터 · 141종 노드 UI
  docs/
    diagrams/       ← SVG 아키텍처 다이어그램
    */guide/        ← 사용자 가이드
    */design/       ← 아키텍처 설계 문서
```

## 설계 문서

주요 기능의 아키텍처 설계 문서입니다. 각 문서에 목적·범위·타입 설계·영향 파일이 포함되어 있습니다.

### 에이전트 & 실행

| 문서 | 설명 |
|------|------|
| [Phase Loop](docs/ko/design/phase-loop.md) | 다중 에이전트 페이즈 워크플로우 + worktree 격리 |
| [Interactive Loop](docs/ko/design/interactive-loop.md) | 대화형 Phase 루프 |
| [Loop Continuity + HITL](docs/ko/design/loop-continuity-hitl.md) | 에이전트 루프 연속성 + Task HITL |
| [Gateway / Direct Execution](docs/ko/design/gateway-direct-execution.md) | 직접/모델/에이전트 경로 분류 및 라우팅 |
| [Execution Guardrails](docs/ko/design/execution-guardrails.md) | 세션 재사용 · 신선도 게이트 · 도구 예산 계약 |
| [PTY Agent Backend](docs/ko/design/pty-agent-backend.md) | 컨테이너 CLI 백엔드 + FailoverError |
| [Execute Dispatcher](docs/ko/design/execute-dispatcher.md) | 실행 디스패치 계층 |
| [Orchestrator LLM](docs/ko/design/orchestrator-llm.md) | 오케스트레이터 LLM 모델 관리 |
| [Request Preflight](docs/ko/design/request-preflight.md) | 요청 전처리 · 분류 · 가드 |
| [Agent Definitions](docs/ko/design/agent-definitions.md) | 에이전트 정의 구조 |
| [Session State Injection](docs/ko/design/session-state-injection.md) | 세션 협력자 외부 주입 · HITL 상태 공유 |
| [Large-File Decomposition](docs/ko/design/large-file-split.md) | 조립/실행 경계 분리 · 컴포지션 루트 설계 |
| [Skill Matching & Completion Check](docs/ko/design/skill-matching-completion-check.md) | FTS5 스킬 자동 매칭 · 완료 체크 · 프로젝트 문서 프로토콜 |

### 워크플로우 엔진

| 문서 | 설명 |
|------|------|
| [Node Registry](docs/ko/design/node-registry.md) | OCP 기반 노드 아키텍처 (141종) |
| [Interaction Nodes](docs/ko/design/interaction-nodes.md) | HITL · Approval · Form · Retry · Batch 노드 |
| [Phase Workflow Runtime](docs/ko/design/phase-workflow-extraction.md) | 페이즈 런타임 모듈 경계 · 의존성 번들 |
| [Parallel Agent Reconciliation](docs/ko/design/parallel-agent-reconciliation.md) | fan-out/fan-in · ReconcileNode · CriticGate |
| [Workflow Tool](docs/ko/design/workflow-tool.md) | 자연어 → 워크플로우 CRUD |
| [Container Code Runner](docs/ko/design/container-code-runner.md) | 다중 언어 컨테이너 샌드박스 |
| [Workflow Builder](docs/ko/design/workflow-builder-command-palette.md) | 커맨드 팔레트 + 노드 검색 |

### 보안 & 격리

| 문서 | 설명 |
|------|------|
| [Security Hardening](docs/ko/design/local-binding-security-hardening.md) | 로컬 바인딩 보안 · 파일시스템 격리 |
| [Multi-Tenant](docs/ko/design/multi-tenant.md) | 팀·사용자·워크스페이스 격리 설계 |
| [Role Protocol Architecture](docs/ko/design/role-protocol-architecture.md) | 역할 기반 프로토콜 정책 |

### 메모리 & 검색

| 문서 | 설명 |
|------|------|
| [Hybrid Vector Search](docs/ko/design/hybrid-vector-search.md) | FTS5/BM25 + 벡터 하이브리드 검색 |
| [Vector Store (sqlite-vec)](docs/ko/design/vector-store-sqlite-vec.md) | sqlite-vec KNN 임베딩 스토어 |
| [Tool Selection FTS5](docs/ko/design/tool-selection-fts5.md) | BM25 기반 도구 자동 선택 |
| [RAG Reference Store](docs/ko/design/rag-reference-store.md) | 레퍼런스 문서 검색 증강 |
| [Memory Search](docs/ko/design/memory-search-upgrade.md) | 청크 단위 검색 · 하이브리드 리트리벌 · 시간 감쇠 |

### 평가 & 품질

| 문서 | 설명 |
|------|------|
| [Evaluation Pipeline](docs/ko/design/evaluation-pipeline.md) | EvalCase · EvalRunner · Scorecard · 프로바이더 비교 |

### 서비스 & 채널

| 문서 | 설명 |
|------|------|
| [Chat NDJSON Streaming](docs/ko/design/chat-ndjson-streaming.md) | 스트리밍 응답 프로토콜 |
| [Persona Message Renderer](docs/ko/design/persona-message-renderer.md) | 페르소나 톤 렌더링 파이프라인 |
| [Kanban Board](docs/ko/design/kanban-board.md) | 칸반 보드 + 자동화 규칙 |
| [i18n Protocol](docs/ko/design/i18n-protocol.md) | 공유 i18n 프로토콜 + 자동화 도구 |
| [Provider-Neutral Output Reduction](docs/ko/design/provider-neutral-output-reduction.md) | 프로바이더 중립 출력 축소 |
| [Multi-Environment Setup](docs/ko/design/multi-environment-setup.md) | 프로파일 기반 환경 조립 · 컨테이너 우선 설정 |

## 트러블슈팅

| 증상 | 해결 |
|------|------|
| `another instance is active` | 동일 Bot Token으로 실행 중인 다른 프로세스 종료 |
| 응답 없음 | 토큰/채널 ID 확인, 로그에서 `channel manager start failed` 확인 |
| 대시보드 시작 실패 | Settings에서 포트 변경 또는 포트 충돌 프로세스 종료 |
| 전송 실패 반복 | `runtime/dlq/dlq.db` 확인, Settings → `channel.dispatch`에서 재시도 설정 조정 |
| 스트리밍 미동작 | Settings → `channel.streaming` 활성화 확인 |
| SDK 백엔드 실패 | 로그의 `backend_fallback` 확인 (`claude_sdk` → `claude_cli` 자동 전환) |
| OAuth Connect 안 됨 | 팝업 차단 해제, Client ID/Secret 확인, Redirect URI 설정 확인 |
| LLM 런타임 점검 | `npm run health:llm` |
| CLI 에이전트 미인증 | `./run.sh login claude --workspace=...` (3.5단계) — 컨테이너는 `~/.claude`가 아닌 `{workspace}/.agents/.claude`를 사용 |
| 평가 실행 | `npm run eval:smoke` (빠른 검증) / `npm run eval:full` (전체 케이스) |

## 라이선스

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only)

Copyright (C) 2026 Hyun Park
