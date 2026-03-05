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
  subgraph Runtime["RuntimeApp"]
    SM["ServiceManager"]

    subgraph Core["Core Services"]
      AD["AgentDomain<br/>tools · skills · memory · tasks"]
      CM["ChannelManager<br/>polling · routing · streaming"]
      DS["DispatchService<br/>retry · DLQ · dedup · rate-limit"]
      OS["OrchestrationService<br/>once · agent · task · phase modes"]
    end

    subgraph Backends["Agent Backends"]
      ABR["AgentBackendRegistry<br/>circuit breaker · fallback"]
      SDK_C["claude_sdk"]
      CLI_C["claude_cli"]
      SDK_X["codex_appserver"]
      CLI_X["codex_cli"]
      CLI_G["gemini_cli"]
      OAI["openai_compatible"]
      CTR["container_cli"]
    end

    subgraph Infra["Infrastructure"]
      CS["CronService"]
      HS["HeartbeatService"]
      OPS["OpsRuntimeService"]
      DB["DashboardService<br/>API · SSE · inline assets"]
      MCP["McpClientManager"]
    end

    BUS(["MessageBus<br/>inbound ↔ outbound"])
  end

  subgraph Channels["Channel Adapters"]
    SL["Slack<br/>@slack/web-api"]
    TG["Telegram"]
    DC["Discord"]
  end

  subgraph Providers["API Providers"]
    OR["OpenRouter"]
    OLLM["Orchestrator LLM<br/>Ollama runtime"]
  end

  SM --> Core & Infra
  ABR --> SDK_C & CLI_C & SDK_X & CLI_X & CLI_G & OAI & CTR

  SL & TG & DC <-->|read/send| CM
  CM -->|publish_inbound| BUS
  BUS -->|consume_inbound| CM
  CM -->|execute| OS
  OS -->|run| ABR
  OS -->|classify| OLLM
  OS -->|chat| OR
  OS -->|tool calls| AD
  CM -->|send reply| DS
  DS -->|deliver| SL & TG & DC
  BUS -->|consume_outbound| DS`,
  },
  {
    name: "inbound-pipeline",
    code: `flowchart LR
  CH["Channel<br/>read()"]
  DD{"Dedup<br/>seen?"}
  PUB["Bus<br/>publish_inbound"]
  CON["Bus<br/>consume_inbound"]
  CMD{"CommandRouter<br/>16 slash commands"}
  APR["ApprovalService<br/>pending check"]
  SEAL["Sensitive Seal<br/>inbound-seal.ts"]
  MEDIA["MediaCollector<br/>file download"]
  ORCH["OrchestrationService"]
  BACK["AgentBackend<br/>cli / sdk"]
  TOOL["Tool Execution<br/>+ secret resolve"]
  REC["SessionRecorder<br/>history save"]
  DISP["DispatchService"]
  OUT["Channel<br/>send()"]

  CH --> DD
  DD -->|new| PUB --> CON
  DD -->|dup| X["skip"]
  CON --> CMD
  CMD -->|slash cmd| DISP
  CMD -->|message| APR
  APR -->|approval text| DISP
  APR -->|normal| SEAL --> MEDIA --> ORCH
  ORCH -->|once/agent/task/phase| BACK
  BACK -->|tool_calls| TOOL
  TOOL -->|result| BACK
  BACK -->|final| REC --> DISP --> OUT

  style X fill:#444,stroke:#666`,
  },
  {
    name: "provider-resilience",
    code: `flowchart TD
  REQ["Orchestration<br/>execute request"]
  REG["AgentBackendRegistry<br/>resolve backend"]
  CB{"CircuitBreaker<br/>can_acquire?"}
  HS["HealthScorer<br/>score / rank"]
  EXEC["Backend.run()"]
  OK["record_success<br/>half_open→closed"]
  FAIL["record_failure<br/>threshold→open"]
  FB["Fallback Backend<br/>same family"]
  RES["AgentRunResult"]

  REQ --> REG
  REG --> HS
  HS -->|"best score"| CB
  CB -->|"closed / half_open"| EXEC
  CB -->|"open"| FB
  EXEC -->|success| OK --> RES
  EXEC -->|failure| FAIL
  FAIL --> FB
  FB -->|"has next"| HS
  FB -->|"exhausted"| ERR["Error Response"]

  subgraph States["Circuit States"]
    direction LR
    CL["closed<br/>모든 요청 허용"]
    OP["open<br/>요청 차단"]
    HO["half_open<br/>제한적 허용"]
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
    CLS{"Complexity Scorer"}
  end

  subgraph Once["once mode"]
    O_EXEC["Single LLM call"]
    O_TOOL{"tool_calls?"}
    O_RUN["Tool Execution"]
    O_FOLLOW["Followup LLM"]
    O_DONE["Return reply"]
  end

  subgraph Agent["agent mode"]
    A_BACK["AgentBackend.run()"]
    A_NAT{"native_tool_loop?"}
    A_SDK["SDK internal loop"]
    A_CLI["CLI single turn"]
    A_TRUN["Tool Execution"]
    A_ITER{"max_turns?"}
    A_DONE["Return result"]
  end

  subgraph Task["task mode"]
    T_PLAN["Build plan nodes"]
    T_NODE["Execute node"]
    T_GATE{"Phase Gate"}
    T_NEXT["Next node"]
    T_DONE["Task complete"]
  end

  subgraph Phase["phase mode"]
    PH_WF["Load workflow<br/>YAML / dynamic"]
    PH_SPAWN["Spawn parallel agents"]
    PH_AGENT1["Agent 1"]
    PH_AGENT2["Agent 2"]
    PH_AGENT3["Agent N"]
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
  DETECT["Detect Sensitive Patterns"]
  SEAL["Seal AES-256-GCM"]
  REF["Replace with secret ref"]
  STORE["SecretVault store"]
  AGENT["Agent receives sealed prompt"]
  TOOL["Tool requests secret"]
  DECRYPT["Vault decrypt JIT"]
  EXEC["Execute with plaintext"]
  RESP["Response redact"]
  OUT["Outbound Message"]

  IN --> DETECT
  DETECT -->|found| SEAL --> REF --> STORE
  DETECT -->|clean| AGENT
  STORE --> AGENT
  AGENT --> TOOL --> DECRYPT --> EXEC
  EXEC --> RESP --> OUT

  subgraph KeyFormat["Key Format"]
    direction LR
    K["inbound.provider.cHash.type.vHash"]
  end

  style SEAL fill:#6a2d2d,stroke:#bf5a5a
  style DECRYPT fill:#2d6a2d,stroke:#5abf5a
  style STORE fill:#2d4a6a,stroke:#5a8abf`,
  },
  {
    name: "role-delegation",
    code: `flowchart TD
  USER["User Message"]
  BTL["🏠 butler<br/>사용자 대면 · 비개발 처리"]
  PM["📋 pm<br/>요구사항 분석 · 스펙 작성"]
  PL["🔧 pl<br/>실행 조율 · Phase Gate"]
  IMPL["⚡ implementer<br/>코드 구현 · 셀프 검증"]
  REV["🔍 reviewer<br/>품질 · 보안 · 성능"]
  VAL["✅ validator<br/>빌드 · 테스트 · lint"]
  DBG["🐛 debugger<br/>RCA · 수정 제안"]
  GEN["🔄 generalist<br/>범용 단일 작업"]

  USER --> BTL
  BTL -->|"기획 필요"| PM
  BTL -->|"즉시 실행"| PL
  PM -->|"스펙 전달"| PL
  PL -->|"구현"| IMPL
  PL -->|"리뷰"| REV
  PL -->|"검증"| VAL
  PL -->|"디버깅"| DBG
  PL -->|"잡무"| GEN
  IMPL -->|"완료"| PL
  REV -->|"결과"| PL
  VAL -->|"결과"| PL

  style BTL fill:#2d4a6a,stroke:#5a8abf
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
  subgraph Orchestrator["Orchestrator"]
    GW["Gateway<br/>lightweight classifier"]
    AB["AgentBus<br/>inter-agent comm · permission matrix"]
    CP["ContainerPool<br/>lifecycle management"]
  end

  subgraph Containers["Docker / Podman"]
    C1["🏠 butler container"]
    C2["⚡ implementer container"]
    C3["🔍 reviewer container"]
  end

  subgraph Security["Container Security"]
    direction LR
    S1["--cap-drop ALL"]
    S2["--read-only"]
    S3["--network none"]
    S4["--user 1000:1000"]
    S5["--pids-limit 100"]
  end

  subgraph Protocol["NDJSON Wire Protocol"]
    direction LR
    TX["orchestrator → container<br/>prompt · tool_result · abort"]
    RX["container → orchestrator<br/>text · tool_call · complete · error"]
  end

  GW -->|"classify route"| CP
  CP -->|"spawn / kill / reconcile"| Containers
  AB <-->|"ask_agent"| C1 & C2 & C3
  C1 & C2 & C3 <-->|"NDJSON via Pty"| CP

  style Orchestrator fill:#1a2a3a,stroke:#3a5a7a
  style Containers fill:#2d4a2d,stroke:#4a8a4a
  style Security fill:#6a2d2d,stroke:#bf5a5a
  style Protocol fill:#3a2a1a,stroke:#7a5a3a`,
  },
  {
    name: "phase-loop-lifecycle",
    code: `flowchart TD
  START["Workflow Start"]
  LOAD["Load Definition<br/>YAML template / dynamic generation"]

  subgraph PhaseN["Phase Execution"]
    CTX["Build phase context<br/>inject prev phase results"]
    SPAWN["Spawn parallel agents"]

    subgraph Agents["Parallel Agents"]
      direction LR
      AG1["Agent 1<br/>independent session"]
      AG2["Agent 2<br/>independent session"]
      AG3["Agent N<br/>independent session"]
    end

    ASK["ask_agent<br/>inter-agent communication<br/>max_depth=3"]
    WAIT["Await all agents"]
    POLICY{"Failure Policy"}
  end

  subgraph Review["Critic Review"]
    CR_EXEC["Critic evaluates<br/>all agent results"]
    CR_GATE{"Gate Decision"}
    CR_RETRY["Retry<br/>inject feedback"]
    CR_ESC["Escalate<br/>user decision"]
  end

  DONE["Workflow Complete<br/>synthesized result"]

  START --> LOAD --> CTX
  CTX --> SPAWN --> Agents
  AG1 & AG2 & AG3 <-.->|"ask_agent"| ASK
  AG1 & AG2 & AG3 --> WAIT
  WAIT --> POLICY
  POLICY -->|"best_effort"| Review
  POLICY -->|"fail_fast · any fail"| CR_ESC
  POLICY -->|"quorum · enough"| Review

  CR_EXEC --> CR_GATE
  CR_GATE -->|"approve"| CTX
  CR_GATE -->|"reject · retry_targeted"| CR_RETRY --> SPAWN
  CR_GATE -->|"reject · escalate"| CR_ESC
  CR_GATE -->|"final phase approved"| DONE

  style PhaseN fill:#3a1a3a,stroke:#7a3a7a
  style Review fill:#1a3a2a,stroke:#3a7a5a
  style Agents fill:#2a2a3a,stroke:#5a5a7a`,
  },
  {
    name: "lane-queue",
    code: `flowchart LR
  MSG["New message<br/>arrives during execution"]

  subgraph Modes["Lane Queue Modes"]
    direction TB
    STEER["🔴 steer<br/>Immediately inject<br/>into running agent"]
    FOLLOW["🟡 followup<br/>Queue for next turn<br/>after completion"]
    COLLECT["🟢 collect<br/>Batch multiple messages<br/>deliver together"]
  end

  RUNNING["Running Agent"]
  QUEUE["Message Queue"]
  NEXT["Next Turn"]

  MSG --> Modes
  STEER -->|"urgent directive"| RUNNING
  FOLLOW -->|"enqueue"| QUEUE
  COLLECT -->|"accumulate"| QUEUE
  QUEUE -->|"agent completes"| NEXT --> RUNNING

  style STEER fill:#6a2d2d,stroke:#bf5a5a
  style FOLLOW fill:#6a5a2d,stroke:#bf9a5a
  style COLLECT fill:#2d6a2d,stroke:#5abf5a`,
  },
  {
    name: "error-recovery",
    code: `flowchart TD
  ERR["Error Detected"]

  ERR --> CLS{"Error Classifier"}

  CLS -->|"context_overflow"| CTX["3-Stage Recovery"]
  CLS -->|"auth_error"| AUTH["Auth Recovery"]
  CLS -->|"rate_limit"| RATE["Rate Limit Recovery"]
  CLS -->|"crash"| CRASH["Crash Recovery"]

  subgraph CTXFlow["Context Overflow"]
    CTX --> CTX1["1. Compaction<br/>summarize history"]
    CTX1 -->|"still over"| CTX2["2. Tool result truncation"]
    CTX2 -->|"still over"| CTX3["3. Give up<br/>return partial"]
  end

  subgraph AuthFlow["Auth Error"]
    AUTH --> AUTH1["Rotate auth profile"]
    AUTH1 -->|"profiles exhausted"| AUTH2["Model failover"]
    AUTH2 -->|"all exhausted"| AUTH3["FailoverError"]
  end

  subgraph RateFlow["Rate Limit"]
    RATE --> RATE1["Exponential backoff"]
    RATE1 -->|"max retries"| RATE2["Fallback backend"]
  end

  subgraph CrashFlow["Crash"]
    CRASH --> CRASH1["Recreate container"]
    CRASH1 --> CRASH2["Restore context"]
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
