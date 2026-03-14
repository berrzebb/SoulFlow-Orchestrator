# Architecture — SoulFlow Orchestrator

채팅 요청을 받아 적절한 실행 경로로 보내고, 결과를 사용자에게 돌려주는 **로컬 우선 비동기 오케스트레이션 런타임**입니다.

---

## 1. 전체 시스템 컴포넌트

```mermaid
flowchart TB
    subgraph Frontend["대시보드 (React + Vite — 12페이지)"]
        direction LR
        DASH_MAIN["Main: Overview · Chat"]
        DASH_BUILD["Build: Prompting · Workflows · Kanban · WBS · Workspace"]
        DASH_CONN["Connect: Channels · Providers"]
        DASH_SYS["System: Secrets · Settings · Admin"]
    end

    subgraph Channels["채널 입력"]
        direction LR
        SL[Slack] & TG[Telegram] & DS[Discord] & WEB[Web Chat]
    end

    subgraph Core["핵심 파이프라인"]
        direction TB
        SEC["보안 게이트\n웹훅 검증 · Sealing · Ingress 정규화"]
        ORCH["오케스트레이터\n분류기 · ToolIndex FTS5/BM25\nGateway 계약 (RequestPlan · CostTier)"]
    end

    subgraph Execution["실행 레이어"]
        direction LR
        AG["에이전트 도메인\n178개 도구 · 8개 역할 스킬"]
        WF["워크플로우 엔진\n141종 노드 · Phase/Agent/Task Loop"]
        PS["프롬프팅 스튜디오\nText · Image · Video · Agent · Gallery · Compare"]
    end

    subgraph Backends["에이전트 백엔드 (9)"]
        direction LR
        SDK["claude_sdk\ncodex_appserver"]
        CLI["claude_cli · codex_cli\ngemini_cli · container_cli"]
        API["openai_compatible\nopenrouter · ollama"]
    end

    subgraph Storage["저장소 (SQLite × 9)"]
        direction LR
        DB1["sessions · tasks · events"]
        DB2["cron · dlq · spans"]
        DB3["vault · kanban · agent-sessions"]
    end

    Channels --> Core
    Frontend <-->|HTTP/SSE| Core
    Core --> Execution
    Execution --> Backends
    Backends --> Storage
    Core --> Storage
```

---

## 2. 모듈 테이블

| 디렉터리 | 역할 |
|----------|------|
| `src/agent/backends/` | 9개 백엔드 어댑터 (CLI 래퍼 + 네이티브 SDK + OpenAI 호환 + Ollama) |
| `src/agent/nodes/` | 141종 워크플로우 노드 핸들러 (OCP 플러그인 아키텍처) |
| `src/agent/pty/` | PTY 기반 CLI 통합 (ContainerPool, AgentBus, NDJSON 와이어) |
| `src/agent/tools/` | 에이전트 도구 178개 (oauth_fetch, workflow, ask-user 등) |
| `src/bootstrap/` | 15개 부트스트랩 모듈 (서비스 조립, main.ts 분해) |
| `src/bus/` | MessageBus (인메모리 기본 / Redis Streams 다중 인스턴스) |
| `src/channels/` | 채널 매니저 · 커맨드 · 디스패치 · 승인 · 페르소나 톤 |
| `src/config/` | Zod 기반 설정 스키마 + env 파싱 |
| `src/cron/` | 크론 스케줄러 (SQLite 영속화) |
| `src/dashboard/` | 웹 대시보드 백엔드 (ops × 13 + routes × 26 + SSE) |
| `src/decision/` | 결정사항 서비스 |
| `src/evals/` | 평가 파이프라인 (EvalRunner, judges, scorers, bundles) |
| `src/events/` | 워크플로우 이벤트 서비스 |
| `src/heartbeat/` | 하트비트 서비스 |
| `src/i18n/` | 공유 i18n 프로토콜 + JSON 로케일 (1,800+ 키) |
| `src/mcp/` | MCP 클라이언트 매니저 (stdio / SSE) |
| `src/oauth/` | OAuth 2.0 연동 (flow-service, token 자동 갱신) |
| `src/orchestration/` | Classifier · ToolIndex · ConfirmationGuard · Gateway 계약 |
| `src/providers/` | LLM 프로바이더 레지스트리 (CircuitBreaker, HealthScorer) |
| `src/runtime/` | ServiceManager · 인스턴스 락 |
| `src/security/` | Secret Vault (AES-256-GCM) · Sealing · Egress 가드 |
| `src/services/` | 도메인 서비스 (embed, vector-store, kanban, webhook, model-catalog) |
| `src/session/` | 세션 저장소 |
| `src/skills/` | 역할 기반 스킬 (8개 역할 + 공유 프로토콜) |
| `web/src/` | React + Vite 대시보드 SPA (i18n, Zustand, React Query) |

---

## 3. 요청 처리 파이프라인

```mermaid
flowchart TD
    subgraph Inbound["인바운드"]
        WHOOK["웹훅 엣지 가드\n서명 검증 · SSRF 차단 · 재전송 방지"]
        CH["채널 read()"]
        SEAL["민감정보 Sealing\nAES-256-GCM 자동 감지"]
        APR["승인 게이트 (HITL)"]
        NGRD["Ingress 정규화\n채널 중립 · 멘션 제거"]
    end

    subgraph Execution["실행"]
        ORCH["오케스트레이터\nonce · agent · task · phase\nToolIndex FTS5/BM25"]
        GW["Gateway 계약\nRequestPlan · CostTier 분류"]
        BACK["에이전트 백엔드 (9)\n가드레일 · 예산 계약 · 세션 재사용"]
        WF["워크플로우 엔진\n141종 노드 · Phase Loop"]
    end

    subgraph Outbound["아웃바운드"]
        REC["세션 기록 · 스팬 · 메트릭"]
        EGRS["토큰 Egress 가드\n출력 시크릿 재밀봉"]
        DISP["DispatchService\n재시도 · DLQ · 중복 방지"]
        OUT["채널 send()"]
    end

    WHOOK --> CH --> SEAL
    SEAL -->|승인 필요| APR --> NGRD
    SEAL -->|일반| NGRD
    NGRD --> ORCH
    ORCH --> GW
    GW --> BACK
    GW --> WF
    WF --> BACK
    BACK --> REC --> EGRS --> DISP --> OUT
```

---

## 4. 에이전트 백엔드 시스템

```mermaid
flowchart TD
    subgraph Registry["AgentBackendRegistry"]
        CB["CircuitBreaker\nclosed → open → half_open → closed"]
        HS["HealthScorer\n응답시간 · 에러율 · 연속 실패 가중치"]
        FB["Fallback Chain\n우선순위 기반 자동 전환"]
        SR["Session Reuse\n성공 세션 재사용 · 실패 세션 격리"]
    end

    subgraph Native["네이티브 SDK"]
        CSDK["claude_sdk\nStreaming · built-in tool_use loop"]
        CAPPS["codex_appserver\nJSON-RPC · 병렬 실행"]
    end

    subgraph CLIWrap["CLI 래퍼 (PTY)"]
        CCLI["claude_cli\nstream-json · --output-format"]
        CCLIX["codex_cli\nNDJSON · --output-format ndjson"]
        GCLI["gemini_cli\nGemini CLI 통합"]
        CTR["container_cli\nDocker/Podman 격리 샌드박스"]
    end

    subgraph Remote["원격 API"]
        OAI["openai_compatible\nvLLM · LM Studio · Together AI"]
        ORT["openrouter\n100+ 모델 · 단일 API"]
        OLL["ollama\n로컬 LLM · http://ollama:11434/v1"]
    end

    CB --> Native & CLIWrap & Remote
    CB -->|장애 감지| FB
    SR --> Native & CLIWrap
```

**자동 fallback 경로:** `claude_sdk` → `claude_cli` / `codex_appserver` → `codex_cli`

---

## 5. 프롬프팅 스튜디오

```mermaid
flowchart LR
    subgraph Studio["/prompting — Prompting Studio"]
        direction TB
        TEXT["Text 탭\n{{variable}} 템플릿\n단일 모델 실행"]
        IMAGE["Image 탭\n이미지 생성\n모델 실행"]
        VIDEO["Video 탭\n동영상 생성\n모델 실행"]
        AGENT["Agent 탭\n에이전트 정의 설계\n+ 테스트 채팅"]
        GALLERY["Gallery 탭\n에이전트 정의 CRUD\n갤러리 관리"]
        COMPARE["Compare 탭\n다중 모델 병렬 실행\nA/B 비교 · 비용 · 레이턴시"]
    end

    AGENT -->|저장| GALLERY
    GALLERY -->|불러오기| AGENT
    COMPARE -.->|모델 성능 비교| AGENT
    TEXT & IMAGE & VIDEO -->|결과| OUT2(["실행 결과"])
```

**Agent 탭 정의 필드:** `name` · `description` · `icon` · `role_skill` · `soul` · `heart` · `tools` · `shared_protocols` · `skills` · `use_when` · `not_use_for` · `extra_instructions`

자연어로 설명 → AI가 전체 필드 자동 생성 (Generate from description).

---

## 6. 워크플로우 엔진

```mermaid
flowchart TD
    subgraph Loops["실행 루프"]
        PL["Phase Loop\n페이즈 × 병렬 에이전트 + critic 검토"]
        AL["Agent Loop\n멀티턴 추론 + 도구 루프 (max 10턴)"]
        TL["Task Loop\nplan → execute → finalize (max 40턴)"]
    end

    subgraph Nodes["141종 노드 (6개 카테고리)"]
        FLOW["Flow 15종\nBranch · Merge · Switch · Router"]
        DATA["Data 69종\nTransform · Filter · Map · Sort · Join"]
        AI_N["AI 10종\nLLM · Embed · Classify · Summarize"]
        INTG["Integration 37종\nHTTP · DB · Slack · GitHub · Email"]
        INTERACT["Interaction 4종\nHITL · Approval · Form · Retry"]
        ADV["Advanced 6종\nBatch · Subflow · Parallel · Code Runner"]
    end

    subgraph Guard["실행 가드레일"]
        BG["Budget Contract\nmax_turns · max_tokens · max_retries"]
        NP["Novelty Policy\n이전 실패 접근 재시도 방지"]
        SC["Short-Circuit\n연속 실패 N회 → 구조화 실패 보고"]
    end

    PL & AL & TL --> Nodes
    Loops --> Guard
    INTERACT -->|ASK_USER · 승인| CH2(["채널 응답"])
```

---

## 7. 보안 아키텍처

```mermaid
flowchart LR
    subgraph Inbound2["인바운드 보안"]
        WEG["웹훅 엣지 가드\n서명 · SSRF · 재전송"]
        SEAL_IN["민감정보 자동 Sealing\n패턴 감지 → AES-256-GCM 암호화"]
        MEDIA_CHK["미디어 보안 검사\n크기(20MB) · 확장자 · 사설 호스트 차단"]
    end

    subgraph Exec2["실행 보안"]
        APR2["승인 게이트 (HITL)\n위험 도구 실행 전 사용자 확인"]
        SEC_INJ["도구별 시크릿 주입\n실행 시점만 복호화"]
        FS["파일시스템 격리\n/data · /agents 외 차단\n../traversal · symlink 차단"]
    end

    subgraph Out2["아웃바운드 보안"]
        EGRS2["토큰 Egress 가드\n출력 시크릿 패턴 재밀봉"]
        SNTZ["출력 정제 (3단계)\nLevel1: 내부 프로토콜 제거\nLevel2: 스트리밍 노이즈 필터\nLevel3: 시크릿 마스킹"]
        DLQ2["DLQ\n전송 실패 → SQLite 저장 + 재시도"]
    end

    Inbound2 --> Exec2 --> Out2
```

**Secret Vault 토큰 형식:** `sv1.{iv}.{tag}.{ciphertext}` (base64url) — AAD 바인딩으로 위조 감지.

---

## 8. 저장소 아키텍처

```mermaid
flowchart LR
    subgraph RT["workspace/runtime/ (운영 DB)"]
        direction TB
        SS["sessions.db\n채널별 대화 세션"]
        TS["tasks.db\n태스크 상태 + 체크포인트"]
        ES["events.db\n워크플로우 이벤트 스트림"]
        CS["cron.db\n크론 잡 + 실행 이력"]
        DLQ3["dlq.db\n전송 실패 메시지"]
        VS["secrets.db\nAES-256-GCM Vault"]
        SP["spans.db\n실행 스팬 · 메트릭 (7일 보존)"]
        KAN["kanban.db\n칸반 보드 + 자동화 규칙"]
        AS["agent-sessions.db\n에이전트 세션 영속화"]
    end

    subgraph WS["workspace/ (파일 기반)"]
        direction TB
        SK["skills/\n사용자 정의 스킬 (SKILL.md)"]
        TP["templates/\nAGENTS · SOUL · HEART · USER"]
        WF2["workflows/\nYAML 워크플로우 템플릿"]
        MEM["memory/\n장기 메모리 + 일일 노트"]
        AG2["agents/\nCLI 인증 토큰 (.claude, .codex, .gemini)"]
    end
```

---

## 9. 관찰성 (Observability)

| 계층 | 수집 항목 | 저장 위치 |
|------|----------|----------|
| **실행 스팬** | trace_id · span_id · duration_ms · status · attributes | `spans.db` |
| **메트릭** | agent.requests · agent.latency_ms · tool.calls · delivery.success/fail | `spans.db` |
| **전달 추적** | 전송 시도 · 재시도 횟수 · 최종 상태 | `dlq.db` + span 연결 |

**선택적 내보내기:** OpenTelemetry (OTLP/gRPC) · Prometheus (pull) · Console JSON.

---

## 10. 대시보드 네비게이션

```
사이드바 그룹
├── Main
│   ├── / (Overview) — SSE 실시간 피드 · 메트릭 · 프로세스
│   └── /chat        — 웹 채팅 · 마크다운 · 스트리밍
├── Build
│   ├── /prompting   — 프롬프팅 스튜디오 (Text/Image/Video/Agent/Gallery/Compare)
│   ├── /workflows   — Phase Loop · 141종 노드 그래프 에디터
│   ├── /kanban      — 칸반 보드 · 자동화 규칙
│   ├── /wbs         — WBS 계층 트리 뷰
│   └── /workspace   — 10탭 (Memory · Sessions · Skills · Cron · Tools ·
│                              Agents · Templates · OAuth · Models · References)
├── Connect
│   ├── /channels    — Slack · Telegram · Discord · Web 연결
│   └── /providers   — 백엔드 CRUD · CircuitBreaker 상태
├── System
│   ├── /secrets     — AES-256-GCM Vault
│   └── /settings    — 런타임 설정
└── Admin (슈퍼어드민)
    └── /admin       — 팀/사용자 관리 · 전역 프로바이더 · 모니터링
```

---

## 11. 문서 연결

- 시작하기: [docs/ko/getting-started/introduction.md](docs/ko/getting-started/introduction.md)
- 설치: [docs/ko/getting-started/installation.md](docs/ko/getting-started/installation.md)
- 에이전트 백엔드: [docs/ko/core-concepts/agents.md](docs/ko/core-concepts/agents.md)
- 보안: [docs/ko/core-concepts/security.md](docs/ko/core-concepts/security.md)
- 워크플로우: [docs/ko/guide/workflows.md](docs/ko/guide/workflows.md)
- 대시보드: [docs/ko/guide/dashboard.md](docs/ko/guide/dashboard.md)
