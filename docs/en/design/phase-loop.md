# Design: Phase Loop — Multi-Agent Phase-Based Workflow

> **Status**: Core implementation complete · PTY/ask_agent/worktree not yet implemented

## Overview

Phase Loop is a new execution model distinct from Agent Loop (1:1) and Task Loop (sequential N:1). It introduces **parallel agents within a phase + critic review → next phase** as a two-dimensional execution matrix.

```
Phase 1: Market Research
  ├─ [Market Analyst]   gpt-5.1-codex-max   ← parallel
  ├─ [Tech Analyst]     gpt-5.1-codex-max   ← parallel
  ├─ [Strategist]       gpt-5.2             ← parallel
  └─ [Critic]           gpt-5.3-codex-spark ← reviews after all complete

Phase 2: Strategy
  ├─ [Strategist]       ...
  ├─ [Risk Analyst]     ...
  └─ [Critic]           ...
```

## Comparison with Existing Loops

| | Agent Loop | Task Loop | **Phase Loop** |
|---|---|---|---|
| Execution unit | Single prompt | Sequential nodes (`TaskNode[]`) | **Phase × parallel agents** |
| Agents | 1 | 1/step | **N/phase + critic** |
| Execution | Synchronous | Sequential | **Parallel within phase, sequential between phases** |
| Conversation | Single session | Single session | **Independent session per agent** |
| Quality gate | None | None | **Critic review** |
| State | `AgentLoopState` | `TaskState` | **`PhaseLoopState`** |
| Mode | `"agent"` | `"task"` | **`"phase"`** |

## Type Design

### PhaseLoopState (contracts.ts extension)

```typescript
interface PhaseLoopState {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  status: "running" | "completed" | "failed" | "cancelled" | "waiting_user_input";

  /** Currently executing phase index (0-based). */
  current_phase: number;
  phases: PhaseState[];
  memory: Record<string, unknown>;
}

interface PhaseState {
  phase_id: string;
  title: string;
  status: "pending" | "running" | "reviewing" | "completed" | "failed";

  agents: PhaseAgentState[];
  critic?: PhaseCriticState;
}

interface PhaseAgentState {
  agent_id: string;
  role: string;
  label: string;
  model: string;
  status: "pending" | "running" | "completed" | "failed";

  /** Conversation history with this agent. */
  messages: PhaseMessage[];
  /** Agent's final output. */
  result?: string;
  usage?: { input: number; output: number; cost?: number };
}

interface PhaseCriticState {
  agent_id: string;
  model: string;
  status: "pending" | "running" | "completed" | "failed";
  /** Critic's review of all agent results. */
  review?: string;
  /** Whether critic approved progression to next phase. */
  approved?: boolean;
  messages: PhaseMessage[];
}

interface PhaseMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}
```

### PhaseLoopRunOptions (loop.types.ts extension)

```typescript
type PhaseLoopRunOptions = {
  workflow_id: string;
  title: string;
  objective: string;
  channel: string;
  chat_id: string;
  phases: PhaseDefinition[];
  initial_memory?: Record<string, unknown>;
  on_phase_change?: (state: PhaseLoopState) => void;
  on_agent_update?: (phase_id: string, agent_id: string, state: PhaseAgentState) => void;
  abort_signal?: AbortSignal;
};

type PhaseDefinition = {
  phase_id: string;
  title: string;
  agents: PhaseAgentDefinition[];
  critic?: PhaseCriticDefinition;
  /** Template to inject previous phase results into agent prompts. */
  context_template?: string;
};

type PhaseAgentDefinition = {
  agent_id: string;
  role: string;
  label: string;
  /** Backend instance_id or provider_type. */
  backend: string;
  model?: string;
  /** System prompt for this agent. */
  system_prompt: string;
  /** Allowed tools. */
  tools?: string[];
  max_turns?: number;
};

type PhaseCriticDefinition = {
  backend: string;
  model?: string;
  system_prompt: string;
  /** If false, critic feedback is logged but does not gate next phase. */
  gate?: boolean;
};
```

## Execution Flow

```
run_phase_loop(options)
  │
  for each phase in phases:
  │
  ├─ 1. phase.status = "running"
  │     Inject previous phase results via context_template
  │
  ├─ 2. Parallel agent execution
  │     Promise.allSettled(agents.map(run_single_agent))
  │     ├─ run_single_agent(agent_def, phase_context)
  │     │   → AgentBackendRegistry.run(AgentRunOptions)
  │     │   → Real-time events: on_agent_update(phase_id, agent_id, state)
  │     │   → Save result + accumulate messages
  │     └─ Broadcast state immediately on each agent completion
  │
  ├─ 3. Critic review (optional)
  │     phase.status = "reviewing"
  │     Pass all agent results to critic
  │     critic.approved = true → next phase
  │     critic.approved = false + gate = true → retry or halt
  │
  └─ 4. phase.status = "completed"
        Merge results into memory

  workflow.status = "completed"
```

## Per-Agent Conversation (Key Differentiator)

Each agent has an independent session, and users can **converse with individual agents**.

### Conversation Scenario

```
[Dashboard UI]
Phase 1: Market Research — Running (2/3 complete)

  ┌─ Market Analyst ────────┐  ┌─ Tech Analyst ────────────┐
  │ ✅ Complete [Result][💬] │  │ ✅ Complete [Result][💬]   │
  └─────────────────────────┘  └───────────────────────────┘

  ┌─ Strategist ────────────┐
  │ 🔄 Running...            │
  └─────────────────────────┘
```

Click "💬" → follow-up conversation with the agent:

```
User: "You missed competitor A in the analysis, please add it."
Market Analyst: "Adding competitor A analysis. [Updated results]"
→ agent.result updated, conversation recorded in agent.messages
```

### API Design

```
GET    /api/workflows                                        → List workflows
GET    /api/workflows/:id                                    → Workflow detail (full PhaseLoopState)
POST   /api/workflows                                        → Create and run workflow

GET    /api/workflows/:id/phases/:pid/agents/:aid/messages   → Agent conversation
POST   /api/workflows/:id/phases/:pid/agents/:aid/messages   → Send message to agent
POST   /api/workflows/:id/phases/:pid/agents/:aid/retry      → Re-run agent

POST   /api/workflows/:id/phases/:pid/critic/messages        → Send message to critic
POST   /api/workflows/:id/cancel                             → Cancel workflow
```

### Session Key

```
workflow:{workflow_id}:phase:{phase_id}:agent:{agent_id}
```

When using PTY backends, this key maps to a PTY handle for per-agent session persistence.

## PTY Backend Integration

Phase Loop is an ideal use case for the PTY backend:

| Phase Loop Requirement | How PTY Solves It |
|------------------------|-------------------|
| Independent agent sessions | PTY handle per agent |
| Conversation persistence | PTY process retains context |
| Parallel execution | Independent PTYs → natural parallelism |
| Follow-up queries | Write to existing PTY |
| Result reuse | In-process history preserved |

Phase Loop works without PTY (standard AgentBackend.run() with history replay). PTY is a **performance optimization layer**, not a hard dependency.

## State Persistence

### SQLite Schema

```sql
CREATE TABLE phase_workflows (
  workflow_id  TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  objective    TEXT NOT NULL,
  channel      TEXT NOT NULL,
  chat_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  state_json   TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE phase_agent_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  TEXT NOT NULL,
  phase_id     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  at           TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES phase_workflows(workflow_id)
);
CREATE INDEX idx_pam_lookup ON phase_agent_messages(workflow_id, phase_id, agent_id);
```

### SSE Events

```typescript
type PhaseLoopEvent =
  | { type: "workflow_started"; workflow_id: string }
  | { type: "phase_started"; workflow_id: string; phase_id: string }
  | { type: "agent_started"; workflow_id: string; phase_id: string; agent_id: string }
  | { type: "agent_completed"; workflow_id: string; phase_id: string; agent_id: string; result: string }
  | { type: "agent_message"; workflow_id: string; phase_id: string; agent_id: string; message: PhaseMessage }
  | { type: "critic_started"; workflow_id: string; phase_id: string }
  | { type: "critic_completed"; workflow_id: string; phase_id: string; approved: boolean; review: string }
  | { type: "phase_completed"; workflow_id: string; phase_id: string }
  | { type: "workflow_completed"; workflow_id: string }
  | { type: "workflow_failed"; workflow_id: string; error: string };
```

## Dashboard Extensions

### Current Subagent UI Limitations

Current `agents.tsx` has subagent cards and `SendAgentModal`, but:

- `POST /api/agents/:id/send` — fire-and-forget (send only, no response visible)
- **No message history API** — cannot view exchanged messages
- Card shows only a single `last_message` line

Phase Loop requires this to become a **bidirectional chat UI**.

### Required Dashboard Changes

| Area | Current | Phase Loop Extension |
|------|---------|---------------------|
| **Sidebar** | 7 pages | + `Workflows` page |
| **Subagent card** | Send button (fire-and-forget) | 💬 Chat panel (bidirectional) |
| **Message history** | None | `GET /api/.../messages` + real-time SSE |
| **Workflow view** | None | Phase tree + agent card grid |
| **Classifier display** | `once/agent/task` | + `phase` mode badge |

### New Page: `/workflows`

```
┌─ Workflows ─────────────────────────────────────────┐
│                                                      │
│ [+ New Workflow]                                     │
│                                                      │
│ ┌─ Market Research ────────────┐  ┌─ Competitor ──┐ │
│ │ Phase 2/3 · Running           │  │ Complete      │ │
│ │ 6 agents · 2 critics         │  │ 3 agents      │ │
│ │ ████████░░░░ 67%              │  │ ██████ 100%   │ │
│ │ [View Details]                │  │ [View Details]│ │
│ └──────────────────────────────┘  └───────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Workflow Detail Page

```
┌────────────────────────────────────────────────────┐
│ PHASE 1: Market Research                            │
│ Complete · 3 agents + 1 critic                      │
│ ████████████████████████████████ 3/3 complete       │
│                                                     │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│ │Market Analyst│ │Tech Analyst │ │ Strategist  │   │
│ │ gpt-5.1     │ │ gpt-5.1     │ │ gpt-5.2     │   │
│ │ ✅ Complete  │ │ ✅ Complete  │ │ ✅ Complete  │   │
│ │[Result] [💬]│ │[Result] [💬]│ │[Result] [💬]│   │
│ └─────────────┘ └─────────────┘ └─────────────┘   │
│          └──────────┼──────────┘                    │
│                     ▼                               │
│             ┌──────────────┐                        │
│             │    Critic    │                        │
│             │ gpt-5.3      │                        │
│             │ ✅ Reviewed   │                        │
│             │[Result] [💬] │                        │
│             └──────────────┘                        │
└────────────────────────────────────────────────────┘
│                     ▼
┌────────────────────────────────────────────────────┐
│ PHASE 2: Strategy                                   │
│ Pending                                             │
└────────────────────────────────────────────────────┘
```

### Agent Chat Panel

Click "💬" to open a right slide panel. Replaces current `SendAgentModal` (one-way) with a **bidirectional chat UI**.

```
┌─ Market Analyst — Chat ────────────────────────────┐
│                                                     │
│ ┌─ Header ────────────────────────────────────────┐ │
│ │ 🤖 Market Analyst  gpt-5.1-codex-max  ✅ Done  │ │
│ │ Phase 1: Market Research                         │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [system] Market research expert role...             │
│                                                     │
│ [assistant] Research results:                        │
│   - Global market size: $4.2T                       │
│   - CAGR: 8.2%                                      │
│   - Key players: ...                                │
│                                                     │
│ [← ask_agent received] From Tech Analyst:           │
│   "Sharing 3nm process status: ..."                 │
│                                                     │
│ [user] Please also analyze company A                │
│                                                     │
│ [assistant] Adding company A:                        │
│   - Revenue: $12.3B                                 │
│   - Market share: 15%                               │
│                                                     │
│ ┌─────────────────────────────────────┐ [Send]      │
│ │ Type a message...                    │             │
│ └─────────────────────────────────────┘             │
└─────────────────────────────────────────────────────┘
```

Chat panel features:
- **Real-time updates**: SSE `agent_message` events auto-append new messages
- **Inter-agent comm display**: `ask_agent` calls/responses shown with distinct styling
- **Result view**: Agent's final `result` shown at top or in separate tab
- **Retry**: Button to re-run agent with initial prompt

### Existing Subagent Card Extension

Current subagent cards in `agents.tsx` can also gain chat capability before Phase Loop:

```
Current:                          Extended:
  ┌─ worker-abc ──────────┐        ┌─ worker-abc ──────────┐
  │ role · model           │        │ role · model           │
  │ RUNNING                │        │ RUNNING                │
  │ last_message line      │        │ last_message line      │
  │ [Cancel] [Send]        │        │ [Cancel] [💬 Chat]     │
  └────────────────────────┘        └────────────────────────┘
```

Required API for subagent chat:

```
GET  /api/agents/:id/messages   → Subagent message history
POST /api/agents/:id/send       → Send message (existing API)
SSE  agent_message event         → Real-time response
```

## Autonomous Inter-Agent Communication

Since agents within a phase are simultaneously alive as PTYs, they can **communicate directly** without routing through the orchestrator.

### Communication Mechanism

Each agent receives an `ask_agent` tool:

```typescript
// Tool available to agents
type AskAgentTool = {
  name: "ask_agent";
  parameters: {
    agent_id: string;   // agent ID within the same phase
    message: string;
  };
};

// Internal implementation
async function ask_agent(agent_id: string, message: string): Promise<string> {
  const pty = pool.get(agent_id);
  pty.write(message);
  return pty.read_until_complete();
}
```

### Communication Topology

```
Hub-and-Spoke (current)        Mesh (PTY autonomous)

  Market Analyst                 Market Analyst ←→ Tech Analyst
       ↕                              ↕    ╲    ↕
  Orchestrator                    Strategist ←→ Critic
       ↕
  Tech Analyst
       ↕
  Strategist
```

### Scenario

```
Market Analyst: "I'm analyzing semiconductor market size, need current process tech data"
  → ask_agent("tech_analyst", "What's the status of 3nm/2nm process tech and key fabs?")
  ← Tech Analyst: "TSMC N3E in production, Samsung 2nm GAA planned 2025..."
Market Analyst: (incorporates tech data into market size analysis)
```

Agents query other agents based on their own judgment, without orchestrator intervention.

### Safeguards

| Risk | Defense |
|------|---------|
| Infinite loop (A→B→A→B...) | Call depth counter (`max_depth=3`) |
| Cost explosion | Per-workflow token budget |
| Concurrency conflict | Per-PTY mutex (one request at a time) |
| Deadlock | A waits for B while B waits for A → timeout (30s) |
| Scope restriction | Can only communicate with agents in the same phase |

### PhaseAgentDefinition Extension

```typescript
type PhaseAgentDefinition = {
  // ... existing fields
  /** Agent IDs this agent can communicate with. Empty = no communication. */
  can_talk_to?: string[];
  /** Max depth for ask_agent calls. Default 3. */
  max_comm_depth?: number;
};
```

## Orchestration Integration

### Mode Classification Extension

```typescript
type ExecutionMode = "once" | "agent" | "task" | "phase";
```

The current classifier (orchestrator LLM) discriminates `once/agent/task/inquiry/builtin`. Adding `phase` mode:

**Classifier prompt extension**:
```
Existing classification:
- once: simple question, single tool call
- agent: multi-step work, multiple tools needed
- task: long-running, step-by-step checkpoints

Addition:
- phase: request requiring multiple specialists to analyze/work in parallel then synthesize
  Examples: "do market research", "full project review", "competitor + tech + strategy analysis"
```

**Phase mode entry conditions**:
1. User explicitly requests via `/workflow` command
2. Dashboard Workflows page creates workflow
3. Classifier returns `phase` → search for matching template in `workspace/workflows/`
4. No match → dynamic workflow generation (classifier decides agent roles/count)

**Classifier output schema extension**:
```typescript
// Current
type ClassificationResult =
  | { mode: "once" | "agent" | "task" }
  | { mode: "inquiry" }
  | { mode: "builtin"; command: string; args?: string };

// Extended
type ClassificationResult =
  | { mode: "once" | "agent" | "task" }
  | { mode: "inquiry" }
  | { mode: "builtin"; command: string; args?: string }
  | { mode: "phase"; workflow_id?: string; suggested_agents?: string[] };
```

### Workflow Definition Format

```yaml
# workspace/workflows/market-research.yaml
title: Market Research
objective: "Comprehensive market analysis for {{topic}}"

phases:
  - phase_id: research
    title: Market Research
    agents:
      - role: Market Analyst
        backend: openrouter
        model: gpt-5.1-codex-max
        system_prompt: "Analyze market size, growth rate, and trends."
        tools: [web_search]
      - role: Tech Analyst
        backend: openrouter
        model: gpt-5.1-codex-max
        system_prompt: "Analyze tech stack, patents, and technology trends."
        tools: [web_search]
      - role: Strategist
        backend: openai_compatible
        model: gpt-5.2
        system_prompt: "Design business model, revenue structure, and entry strategy."
    critic:
      backend: openrouter
      model: gpt-5.3-codex-spark
      system_prompt: "Review logical consistency, data evidence, and missing items across all analyses."
      gate: true

  - phase_id: strategy
    title: Strategy
    context_template: |
      ## Previous Phase Results
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
      ### Critic Feedback
      {{prev_phase.critic.review}}
    agents:
      - role: Strategist
        ...
```

## Design Decisions

Concrete resolutions for the 7 design gaps identified during earlier discussion.

### 1. PTY Input/Output Protocol

NDJSON wire format over PTY stdin/stdout.

**Input (orchestrator → PTY)**:
```json
{"type":"user_message","content":"Analyze the market size","metadata":{"phase_id":"research","turn":1}}
{"type":"ask_agent_request","from":"tech_analyst","content":"What's the 3nm process status?","request_id":"req-001"}
```

**Output (PTY → orchestrator)**:
```json
{"type":"assistant_chunk","content":"Starting analysis...","delta":true}
{"type":"tool_use","tool":"web_search","input":{"query":"semiconductor market 2025"}}
{"type":"tool_result","tool":"web_search","output":"...search results..."}
{"type":"assistant_message","content":"The global semiconductor market is..."}
{"type":"complete","result":"Final analysis results...","usage":{"input":1200,"output":800}}
```

**Completion detection**: `{"type":"complete"}` event marks end of turn. `read_until_complete()` buffers until this event and returns.

**Errors**: `{"type":"error","code":"timeout"|"crash"|"token_limit","message":"..."}` — errors are also treated as turn termination.

### 2. Message Persistence Architecture

PTY handles I/O transport only. Persistence is handled by an **interceptor layer**.

```
Orchestrator
  │
  ├─ PtyMessageInterceptor  ← intercepts all PTY I/O
  │    ├─ DB write: phase_agent_messages INSERT
  │    ├─ SSE emit: agent_message event
  │    ├─ PhaseAgentState.messages update
  │    └─ Pass-through: forward original message to consumer
  │
  └─ PTY[agent]
```

```typescript
class PtyMessageInterceptor {
  constructor(
    private db: PhaseWorkflowStore,
    private sse: SSEBroadcaster,
    private state: PhaseAgentState,
  ) {}

  /** Record before writing message to PTY. */
  on_input(msg: PtyInputMessage): void {
    this.db.insert_message(this.state.agent_id, "user", msg.content);
    this.state.messages.push({ role: "user", content: msg.content, at: now() });
  }

  /** Record before forwarding PTY output to consumer. */
  on_output(msg: PtyOutputMessage): void {
    if (msg.type === "assistant_message" || msg.type === "complete") {
      this.db.insert_message(this.state.agent_id, "assistant", msg.content);
      this.state.messages.push({ role: "assistant", content: msg.content, at: now() });
      this.sse.emit({ type: "agent_message", ...ids, message: last(this.state.messages) });
    }
  }
}
```

PTY itself knows nothing about persistence → separation of concerns. Non-PTY backends use the same interceptor.

### 3. ask_agent Concurrency Policy

When target agent is busy: **queue with timeout**.

```
ask_agent("tech_analyst", "3nm status")
  │
  ├─ tech_analyst idle?
  │   yes → process immediately, acquire mutex
  │   no  → enqueue request
  │
  ├─ queue depth ≤ 3?
  │   yes → wait (timeout: 30s)
  │   no  → reject immediately { error: "agent_busy", retry_after_ms: 5000 }
  │
  └─ timeout?
      yes → { error: "agent_timeout", message: "tech_analyst did not respond within 30s" }
```

**Rationale**:
- Immediate reject forces callers to implement retry logic → added complexity
- Infinite blocking risks deadlock
- Queue + depth limit + timeout provides optimal balance

**Deadlock prevention**: Detect simultaneous A→B + B→A calls. If the request graph contains a cycle, the later request is immediately rejected with `{ error: "deadlock_detected" }`.

### 4. Phase Failure Policy

Behavior when some agents within a phase fail. **Configurable per-phase**.

```typescript
type PhaseDefinition = {
  // ... existing fields
  /** Behavior on agent failure. Default: "best_effort" */
  failure_policy?: "fail_fast" | "best_effort" | "quorum";
  /** Minimum successes required for quorum policy. */
  quorum_count?: number;
};
```

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `fail_fast` | Any failure → phase fails immediately | All agent results are mandatory |
| `best_effort` | Continue with available results | Research/analysis (partial gaps acceptable) |
| `quorum` | Proceed if ≥ N succeed, fail otherwise | Voting/consensus-based decisions |

**Default**: `best_effort` — most practical for research/analysis workflows.

**Failed agent handling**:
- `PhaseAgentState.status = "failed"`, error reason recorded in `error` field
- Failed agent results excluded from critic input; critic is informed of the failure
- SSE `agent_failed` event emitted (addition to existing events)

```typescript
// Additional SSE event
| { type: "agent_failed"; workflow_id: string; phase_id: string; agent_id: string; error: string }
```

### 5. Critic Rejection Retry Strategy

Behavior when critic returns `approved = false`. **Configurable per-critic**.

```typescript
type PhaseCriticDefinition = {
  // ... existing fields
  /** Behavior on rejection. Default: "escalate" */
  on_rejection?: "retry_all" | "retry_targeted" | "escalate";
  /** Maximum retry count. Default: 1 */
  max_retries?: number;
};
```

| Strategy | Behavior | Cost Impact |
|----------|----------|-------------|
| `retry_all` | Re-run all agents (with critic feedback injected) | High (N × retries) |
| `retry_targeted` | Re-run only agents flagged by critic | Medium |
| `escalate` | Delegate decision to user (continue/retry/abort) | None (waiting) |

**Default**: `escalate` — ensures cost control + user decision-making.

**Feedback injection on retry**:
```
[system] The critic provided the following feedback on your previous attempt:
---
{critic.review}
---
Please improve your analysis incorporating this feedback.
```

**Escalate flow**:
```
workflow.status = "waiting_user_input"
  → SSE: { type: "critic_rejected", workflow_id, phase_id, review }
  → Dashboard: present 3 choices to user
    1. "Continue" → ignore critic feedback, proceed to next phase
    2. "Retry" → re-execute (choose retry_all or retry_targeted)
    3. "Abort" → cancel workflow
```

**Normalized critic feedback structure** (for targeted retry):
```typescript
interface CriticReview {
  approved: boolean;
  summary: string;
  /** Per-agent evaluation. On targeted retry, only low_quality agents are re-run. */
  agent_reviews?: Array<{
    agent_id: string;
    quality: "good" | "needs_improvement" | "low_quality";
    feedback: string;
  }>;
}
```

### 6. Dynamic Workflow Generation

Mechanism for auto-generating workflows when no template matches.

**Two-step process**:

```
1. Classifier: { mode: "phase", workflow_id: undefined }
2. Template search: workspace/workflows/*.yaml → no match
3. Invoke workflow planner (separate LLM turn)
4. Generated PhaseDefinition[] → save to DB → execute
```

**Workflow planner prompt**:
```
User objective: "{objective}"

Available backends: [{backend_id, provider, models}]
Available tools: [{name, description}]

Design a workflow within these constraints:
- Maximum phases: 3
- Maximum agents per phase: 5
- Assign each agent a clear role and system_prompt
- Separate sequentially dependent tasks into different phases
- Set critic gate=true (quality assurance)

Output format: PhaseDefinition[] as JSON
```

**Storage**: Generated workflows saved in DB `phase_workflows` table with `source: "generated"` tag. Not written to filesystem (one-off).

**User confirmation**: Present generated workflow as preview → execute only after approval. No automatic execution (cost control).

```
[Dashboard or Channel]
🤖 Generated the following workflow:

Phase 1: Market Research (3 agents + critic)
  - Market Analyst: market size, growth rate analysis
  - Tech Analyst: technology trend analysis
  - Competitor Analyst: key competitor comparison

Phase 2: Strategy (2 agents + critic)
  - Strategist: entry strategy development
  - Risk Analyst: risk factor assessment

[Execute] [Edit] [Cancel]
```

### 7. Parallel Agent Filesystem Conflicts

Preventing conflicts when parallel agents modify files simultaneously.

**Strategy by agent type**:

| Type | Filesystem Access | Isolation Strategy |
|------|-------------------|-------------------|
| Analysis/research agents | Read-only + text output | No isolation needed |
| Code-writing agents | Read/write | Worktree isolation |
| Hybrid (analysis + code) | Read/write | Worktree isolation |

**Workspace directory structure**:
```
workspace/workflows/{workflow_id}/
  ├─ shared/              ← written by orchestrator, read-only for agents
  │   ├─ context.md       ← previous phase results
  │   └─ objective.md     ← workflow objective
  ├─ agents/
  │   ├─ market_analyst/  ← agent-specific working directory
  │   ├─ tech_analyst/
  │   └─ strategist/
  └─ output/              ← final merged results
```

**Code-writing scenario (git worktree)**:
```
git worktree add .worktrees/{agent_id} -b workflow/{workflow_id}/{agent_id}

After phase completion:
  1. Collect diffs from each agent branch
  2. Conflict check (overlapping file changes)
  3. No conflicts → auto-merge
  4. Conflicts → delegate to critic or escalate to user
```

**PhaseAgentDefinition extension**:
```typescript
type PhaseAgentDefinition = {
  // ... existing fields
  /** Filesystem isolation mode. Default: "none" */
  filesystem_isolation?: "none" | "directory" | "worktree";
};
```

- `none`: No isolation (analysis agents, text output only)
- `directory`: Dedicated directory assigned, no access to other agents' directories
- `worktree`: Full git worktree isolation (code-modifying agents)

## Related Docs

→ [PTY-Based Agent Backend](./pty-agent-backend.md)
→ [Agent System](../core-concepts/agents.md)
→ [Provider Configuration Guide](../guide/providers.md)
