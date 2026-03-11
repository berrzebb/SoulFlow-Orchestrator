/**
 * Mermaid 다이어그램 → SVG 생성 스크립트.
 * 실행: node scripts/generate-diagrams.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMermaid, THEMES } from "@vercel/beautiful-mermaid";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "diagrams");

function get_theme() {
  const themes = THEMES;
  if (themes && typeof themes === "object" && "vercel-dark" in themes) {
    return themes["vercel-dark"];
  }
  return {};
}

const diagrams = [
  {
    name: "service-architecture",
    code: `flowchart TD
  subgraph Runtime["RuntimeApp (bootstrap/ 15모듈)"]
    SM["ServiceManager"]

    subgraph Core["Core Services"]
      AD["AgentDomain\nToolIndex · SkillIndex · memory · tasks"]
      CM["ChannelManager\npolling · routing · streaming · LaneQueue"]
      DS["DispatchService\nretry · DLQ · dedup · rate-limit"]
      OS["OrchestrationService\nonce · agent · task · phase"]
    end

    subgraph Backends["Agent Backends (CircuitBreaker)"]
      ABR["AgentBackendRegistry\ncircuit breaker · HealthScorer · fallback"]
      SDK_C["claude_sdk"]
      CLI_C["claude_cli"]
      SDK_X["codex_appserver"]
      CLI_X["codex_cli"]
      CLI_G["gemini_cli"]
      OAI["openai_compatible"]
      OLL["ollama"]
      CTR["container_cli"]
    end

    subgraph Infra["Infrastructure"]
      CS["CronService"]
      HS["HeartbeatService"]
      OPS["OpsRuntimeService\n(ops/ 13모듈)"]
      DB["DashboardService\nAPI · SSE · Web 채팅 · i18n"]
      MCP["McpClientManager"]
    end

    BUS(["MessageBus\ninbound ↔ outbound ↔ progress"])
  end

  subgraph Channels["Channel Adapters (선택)"]
    SL["Slack"]
    TG["Telegram"]
    DC["Discord"]
  end

  subgraph Providers["LLM Providers"]
    OR["OrchestratorLLM\nOllama / OpenRouter"]
  end

  SM --> Core & Infra
  ABR --> SDK_C & CLI_C & SDK_X & CLI_X & CLI_G & OAI & CTR

  SL & TG & DC <-->|read/send| CM
  DB <-->|SSE 채팅| CM
  CM -->|publish_inbound| BUS
  BUS -->|consume_inbound| CM
  CM -->|execute| OS
  OS -->|run| ABR
  OS -->|classify| OR
  OS -->|tool calls| AD
  CM -->|send reply| DS
  DS -->|deliver| SL & TG & DC`,
  },
  {
    name: "inbound-pipeline",
    code: `flowchart LR
  CH["채널 read()"]
  DD{"중복 체크\nDedup"}
  BUS["MessageBus\npublish_inbound"]
  CMD{"CommandRouter\n슬래시 커맨드\n+ 퍼지 매칭"}
  GUARD["ConfirmationGuard\n위험 작업 확인"]
  APR["ApprovalService\n승인 대기 확인"]
  SEAL["Sensitive Seal\nAES-256-GCM"]
  MEDIA["MediaCollector\n파일 다운로드"]
  ORCH["OrchestrationService\nonce · agent · task · phase"]
  BACK["AgentBackend\ncli / sdk"]
  TOOL["도구 실행\n+ 시크릿 복호화"]
  REC["SessionRecorder\n히스토리 저장"]
  DISP["DispatchService"]
  OUT["채널 send()"]

  CH --> DD
  DD -->|신규| BUS --> CMD
  DD -->|중복| X["skip"]
  CMD -->|슬래시 커맨드| DISP
  CMD -->|메시지| GUARD
  GUARD -->|위험 작업| APR
  GUARD -->|일반| SEAL
  APR -->|승인 완료| SEAL
  APR -->|승인 대기| DISP
  SEAL --> MEDIA --> ORCH
  ORCH --> BACK
  BACK -->|tool_calls| TOOL
  TOOL -->|result| BACK
  BACK --> REC --> DISP --> OUT

  style X fill:#444,stroke:#666`,
  },
  {
    name: "provider-resilience",
    code: `flowchart TD
  REQ["Orchestration\nexecute request"]
  REG["AgentBackendRegistry\nresolve backend"]
  HS["HealthScorer\nscore / rank"]
  CB{"CircuitBreaker\ncan_acquire?"}
  EXEC["Backend.run()"]
  OK["record_success\nhalf_open→closed"]
  FAIL["record_failure\nthreshold→open"]
  FB["Fallback Backend\nsame family"]
  RES["AgentRunResult"]

  REQ --> REG --> HS
  HS -->|"best score"| CB
  CB -->|"closed / half_open"| EXEC
  CB -->|"open"| FB
  EXEC -->|success| OK --> RES
  EXEC -->|failure| FAIL --> FB
  FB -->|"has next"| HS
  FB -->|"exhausted"| ERR["Error Response"]

  subgraph States["Circuit States"]
    direction LR
    CL["closed\n모든 요청 허용"]
    OP["open\n요청 차단"]
    HO["half_open\n제한적 허용"]
    CL -->|"N회 실패"| OP
    OP -->|"timeout 경과"| HO
    HO -->|"성공"| CL
    HO -->|"실패"| OP
  end

  subgraph Pairs["Fallback Pairs"]
    direction LR
    P1["claude_sdk → claude_cli"]
    P2["codex_appserver → codex_cli"]
  end

  style CL fill:#2d6a2d,stroke:#4a4
  style OP fill:#6a2d2d,stroke:#a44
  style HO fill:#6a5a2d,stroke:#a94`,
  },
  {
    name: "orchestrator-flow",
    code: `flowchart TD
  REQ["Inbound Message"]

  subgraph Classify["Classification"]
    CLS{"Complexity Scorer\n(CD Scoring)"}
  end

  subgraph Once["once mode\n간단한 단일 응답"]
    O_EXEC["Single LLM call"]
    O_TOOL{"tool_calls?"}
    O_RUN["Tool Execution"]
    O_FOLLOW["Followup LLM"]
    O_DONE["Return reply"]
  end

  subgraph Agent["agent mode\n복잡한 에이전트 루프"]
    A_BACK["AgentBackend.run()"]
    A_NAT{"native_tool_loop?"}
    A_SDK["SDK internal loop\n(claude_sdk / codex_appserver)"]
    A_CLI["CLI single turn\n(claude_cli / codex_cli / gemini_cli)"]
    A_TRUN["Tool Execution"]
    A_ITER{"max_turns?"}
    A_DONE["Return result"]
  end

  subgraph Task["task mode\n다단계 노드 실행"]
    T_PLAN["Build plan nodes"]
    T_NODE["Execute node\n(DAG 141종)"]
    T_GATE{"Phase Gate"}
    T_NEXT["Next node"]
    T_DONE["Task complete"]
  end

  subgraph Phase["phase mode\n병렬 에이전트 + Critic"]
    PH_WF["Load workflow\nYAML / dynamic"]
    PH_SPAWN["Spawn parallel agents"]
    PH_AGENT1["Agent 1\n독립 세션"]
    PH_AGENT2["Agent 2\n독립 세션"]
    PH_AGENT3["Agent N\n독립 세션"]
    PH_WAIT["Await all agents"]
    PH_CRITIC{"Critic review"}
    PH_NEXT["Next phase"]
    PH_DONE["Workflow complete"]
  end

  REQ --> CLS
  CLS -->|"simple"| Once
  CLS -->|"complex"| Agent
  CLS -->|"multi-step"| Task
  CLS -->|"workflow"| Phase

  O_EXEC --> O_TOOL
  O_TOOL -->|yes| O_RUN --> O_FOLLOW --> O_DONE
  O_TOOL -->|no| O_DONE

  A_BACK --> A_NAT
  A_NAT -->|"SDK/AppServer"| A_SDK --> A_DONE
  A_NAT -->|"CLI"| A_CLI --> A_TRUN --> A_ITER
  A_ITER -->|"continue"| A_CLI
  A_ITER -->|"done"| A_DONE

  T_PLAN --> T_NODE --> T_GATE
  T_GATE -->|pass| T_NEXT --> T_NODE
  T_GATE -->|fail| T_NODE
  T_GATE -->|"all done"| T_DONE

  PH_WF --> PH_SPAWN
  PH_SPAWN --> PH_AGENT1 & PH_AGENT2 & PH_AGENT3
  PH_AGENT1 & PH_AGENT2 & PH_AGENT3 --> PH_WAIT
  PH_WAIT --> PH_CRITIC
  PH_CRITIC -->|"approve"| PH_NEXT --> PH_SPAWN
  PH_CRITIC -->|"reject"| PH_SPAWN
  PH_CRITIC -->|"final phase"| PH_DONE

  style Once fill:#1a3a2a,stroke:#3a7a5a
  style Agent fill:#1a2a3a,stroke:#3a5a7a
  style Task fill:#3a2a1a,stroke:#7a5a3a
  style Phase fill:#3a1a3a,stroke:#7a3a7a`,
  },
  {
    name: "sensitive-seal-flow",
    code: `flowchart LR
  IN["Inbound Message"]
  DETECT["Sensitive Pattern 감지\n(API 키 · 토큰 · 비밀번호)"]
  SEAL["Seal AES-256-GCM\nSecretVault 저장"]
  REF["secret ref 토큰으로 교체\ninbound.provider.cHash.type.vHash"]
  AGENT["에이전트 수신\n(sealed prompt)"]
  TOOL["도구가 secret ref 요청"]
  DECRYPT["Vault JIT 복호화\n(도구 경로에서만)"]
  EXEC["평문으로 실행"]
  RESP["응답 redact\n(secret ref 재주입)"]
  OUT["Outbound Message"]

  IN --> DETECT
  DETECT -->|민감 패턴 발견| SEAL --> REF --> AGENT
  DETECT -->|클린| AGENT
  AGENT --> TOOL --> DECRYPT --> EXEC --> RESP --> OUT

  style SEAL fill:#6a2d2d,stroke:#bf5a5a
  style DECRYPT fill:#2d6a2d,stroke:#5abf5a`,
  },
  {
    name: "role-delegation",
    code: `flowchart TD
  USER["사용자 메시지"]
  CON["🏠 concierge\n사용자 대면 · 일상 처리 · 위임 조율"]
  PM["📋 pm\n요구사항 분석 · 스펙 작성 · Kanban board"]
  PL["🔧 pl\n실행 조율 · Phase Gate · Kanban cards"]
  IMPL["⚡ implementer\n코드 구현 · 셀프 검증 · PR 작성"]
  REV["🔍 reviewer\n품질 · 보안 · 성능 · 코드 리뷰"]
  VAL["✅ validator\n빌드 · 테스트 · lint · 자동수정"]
  DBG["🐛 debugger\nRCA · 재현 · 수정 제안"]
  GEN["🔄 generalist\n범용 단일 작업"]

  USER --> CON
  CON -->|"기획 필요"| PM
  CON -->|"즉시 실행"| PL
  PM -->|"스펙 전달"| PL
  PL -->|"구현"| IMPL
  PL -->|"리뷰"| REV
  PL -->|"검증"| VAL
  PL -->|"디버깅"| DBG
  PL -->|"잡무"| GEN
  IMPL -->|"완료"| PL
  REV -->|"결과"| PL
  VAL -->|"결과"| PL

  style CON fill:#2d4a6a,stroke:#5a8abf
  style PM fill:#4a2d6a,stroke:#8a5abf
  style PL fill:#2d6a4a,stroke:#5abf8a
  style IMPL fill:#6a5a2d,stroke:#bf9a5a
  style REV fill:#6a2d4a,stroke:#bf5a8a
  style VAL fill:#2d6a2d,stroke:#5abf5a
  style DBG fill:#6a2d2d,stroke:#bf5a5a
  style GEN fill:#4a4a4a,stroke:#8a8a8a`,
  },
  {
    name: "container-architecture",
    code: `flowchart TD
  subgraph Orchestrator["Orchestrator (container_cli 백엔드)"]
    CP["ContainerPool\nlifecycle: spawn · kill · reconcile"]
    AB["AgentBus\nask_agent · permission matrix · max_depth=3"]
    PTY["PtyTransport\nNDJSON wire protocol"]
  end

  subgraph Containers["Docker / Podman 컨테이너"]
    C1["🏠 concierge 컨테이너"]
    C2["⚡ implementer 컨테이너"]
    C3["🔍 reviewer 컨테이너"]
  end

  subgraph Security["컨테이너 보안"]
    direction LR
    S1["--cap-drop ALL"]
    S2["--read-only rootfs"]
    S3["--network none"]
    S4["--pids-limit 100"]
    S5["resource limits"]
  end

  subgraph Protocol["NDJSON Wire Protocol"]
    direction LR
    TX["orchestrator → container\nprompt · tool_result · abort"]
    RX["container → orchestrator\ntext · tool_call · complete · error"]
  end

  CP -->|"spawn / kill"| Containers
  AB <-->|"ask_agent"| C1 & C2 & C3
  C1 & C2 & C3 <-->|"stdin/stdout NDJSON"| PTY

  style Orchestrator fill:#1a2a3a,stroke:#3a5a7a
  style Containers fill:#2d4a2d,stroke:#4a8a4a
  style Security fill:#6a2d2d,stroke:#bf5a5a
  style Protocol fill:#3a2a1a,stroke:#7a5a3a`,
  },
  {
    name: "phase-loop-lifecycle",
    code: `flowchart TD
  START["Workflow 시작"]
  LOAD["Definition 로드\nYAML 템플릿 / 자연어 → 동적 생성"]

  subgraph PhaseN["Phase 실행 (반복)"]
    CTX["Phase 컨텍스트 구성\n이전 phase 결과 inject"]
    SPAWN["병렬 에이전트 스폰"]

    subgraph Agents["병렬 에이전트 (독립 세션)"]
      direction LR
      AG1["Agent 1"]
      AG2["Agent 2"]
      AG3["Agent N"]
    end

    WAIT["모든 에이전트 대기"]
    POLICY{"실패 정책"}
  end

  subgraph Review["Critic 리뷰"]
    CR_EXEC["Critic이 모든 결과 평가"]
    CR_GATE{"Gate 결정"}
    CR_RETRY["재시도\n피드백 inject"]
    CR_ESC["사용자 에스컬레이션\nASK_USER"]
  end

  DONE["Workflow 완료\n결과 합성"]

  START --> LOAD --> CTX
  CTX --> SPAWN --> Agents
  AG1 & AG2 & AG3 <-.->|"ask_agent\nmax_depth=3"| SPAWN
  AG1 & AG2 & AG3 --> WAIT
  WAIT --> POLICY
  POLICY -->|"best_effort"| Review
  POLICY -->|"fail_fast"| CR_ESC
  POLICY -->|"quorum"| Review

  CR_EXEC --> CR_GATE
  CR_GATE -->|"approve"| CTX
  CR_GATE -->|"reject · retry"| CR_RETRY --> SPAWN
  CR_GATE -->|"reject · escalate"| CR_ESC
  CR_GATE -->|"최종 phase 승인"| DONE

  style PhaseN fill:#3a1a3a,stroke:#7a3a7a
  style Review fill:#1a3a2a,stroke:#3a7a5a
  style Agents fill:#2a2a3a,stroke:#5a5a7a`,
  },
  {
    name: "lane-queue",
    code: `flowchart LR
  MSG["실행 중 새 메시지 도착"]

  subgraph Modes["LaneQueue 모드"]
    direction TB
    STEER["🔴 steer\n실행 중 에이전트에\n즉시 inject (방향 전환)"]
    FOLLOW["🟡 followup\n완료 후 다음 턴에\n큐에서 처리"]
    COLLECT["🟢 collect\n여러 메시지 배치 수집\n한 번에 전달"]
  end

  RUNNING["실행 중 에이전트"]
  QUEUE["메시지 큐"]
  NEXT["다음 턴"]

  MSG --> Modes
  STEER -->|"긴급 지시"| RUNNING
  FOLLOW -->|"enqueue"| QUEUE
  COLLECT -->|"accumulate"| QUEUE
  QUEUE -->|"에이전트 완료 시"| NEXT --> RUNNING

  style STEER fill:#6a2d2d,stroke:#bf5a5a
  style FOLLOW fill:#6a5a2d,stroke:#bf9a5a
  style COLLECT fill:#2d6a2d,stroke:#5abf5a`,
  },
  {
    name: "error-recovery",
    code: `flowchart TD
  ERR["에러 감지"]

  ERR --> CLS{"에러 분류"}

  CLS -->|"context_overflow"| CTX["3단계 복구"]
  CLS -->|"auth_error"| AUTH["인증 복구"]
  CLS -->|"rate_limit"| RATE["Rate Limit 복구"]
  CLS -->|"crash"| CRASH["Crash 복구"]

  subgraph CTXFlow["Context Overflow"]
    CTX --> CTX1["1. Compaction\n히스토리 요약"]
    CTX1 -->|"여전히 초과"| CTX2["2. Tool result 截断"]
    CTX2 -->|"여전히 초과"| CTX3["3. 포기\n부분 결과 반환"]
  end

  subgraph AuthFlow["Auth Error"]
    AUTH --> AUTH1["auth profile 순환"]
    AUTH1 -->|"모두 소진"| AUTH2["모델 failover"]
    AUTH2 -->|"모두 소진"| AUTH3["FailoverError 반환"]
  end

  subgraph RateFlow["Rate Limit"]
    RATE --> RATE1["Exponential backoff"]
    RATE1 -->|"max retries 초과"| RATE2["Fallback backend 전환"]
  end

  subgraph CrashFlow["Crash (container_cli)"]
    CRASH --> CRASH1["컨테이너 재생성"]
    CRASH1 --> CRASH2["컨텍스트 복원"]
  end

  style CTXFlow fill:#3a2a1a,stroke:#7a5a3a
  style AuthFlow fill:#3a1a2a,stroke:#7a3a5a
  style RateFlow fill:#1a3a2a,stroke:#3a7a5a
  style CrashFlow fill:#1a2a3a,stroke:#3a5a7a`,
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const theme = get_theme();

  for (const { name, code } of diagrams) {
    const outPath = join(OUT_DIR, `${name}.svg`);
    try {
      const svg = await renderMermaid(code, { ...theme, animate: false });
      await writeFile(outPath, svg, "utf-8");
      process.stdout.write(`OK  ${name}.svg (${svg.length} bytes)\n`);
    } catch (err) {
      process.stderr.write(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
