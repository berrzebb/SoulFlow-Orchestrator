# Design: Container-Based Agent Backend

> **Status**: Core infrastructure implemented · Production features in progress

## Motivation

Current CLI backends (`claude_cli`, `codex_cli`) create and destroy a process per request. Limitations:

- **History replay**: Full conversation history passed as arguments on every request — O(n) cost
- **Session loss**: Internal context lost when process exits, `supports_resume = false`
- **Agent isolation**: Agents within the same user session cannot share progress

## Core Idea

**One agent = one Docker container.** Abstract via a `node-pty` compatible interface so upper layers are transport-agnostic.

```
┌──────────────────────────────────────────────────┐
│                  Orchestrator                     │
│                                                   │
│  ┌──────────────┐     ┌────────────────────────┐ │
│  │   Gateway     │────→│  AgentBus (comms)       │ │
│  │ phi-classifier│     │ ask/send/broadcast     │ │
│  └──────────────┘     │ permission matrix      │ │
│                        │ request/reply match    │ │
│                        └───────────┬────────────┘ │
│                                    │ Pty interface │
│                        ┌───────────┴────────────┐ │
│                        │ ContainerPool (mgmt)    │ │
│                        │ spawn/kill/reconcile   │ │
│                        │ resource limits        │ │
│                        └───────────┬────────────┘ │
│                                    │ Docker API    │
│                        ┌───────────┴────────────┐ │
│                        │ Docker Socket Proxy     │ │
│                        └───────────┬────────────┘ │
└────────────────────────────────────┼──────────────┘
                       ┌─────────────┼─────────────┐
                       │             │             │
                  ┌────┴───┐   ┌────┴────┐   ┌───┴──────┐
                  │ butler │   │  impl   │   │ reviewer │
                  │ claude │   │  codex  │   │ claude   │
                  └────────┘   └─────────┘   └──────────┘
```

### Design Decisions

- **Docker-only**: Always runs in Linux containers. WSL2 for Windows, Docker/K8s for production.
- **node-pty compatible interface**: `spawn`/`write`/`onData`/`onExit`/`kill` — upper layers don't know about Docker.
- **Separation of comms and management**: AgentBus routes messages, ContainerPool manages container lifecycle.
- **Gateway**: Lightweight classifier (orchestrator LLM) classifies messages first, routing to PTY spawn or Native turn.

---

## Pty Interface

Same interface as `node-pty`'s `IPty`. Backend implementation is swappable.

### spawn

```typescript
function spawn(
  file: string,                  // "claude", "codex"
  args: string[],                // ["--headless", "--session", key, "--output-format", "stream-json"]
  options: {
    name: string;                // container name: "agent-slack-C123-butler"
    cols: number;                // terminal width (reference only in headless)
    rows: number;                // terminal height
    cwd: string;                 // working directory: "/workspace"
    env: Record<string, string>; // environment variables (API keys, etc.)
  }
): Pty;
```

### Pty

```typescript
interface Pty {
  /** Container ID or process ID. */
  readonly pid: string;

  /** Send data — writes to Docker attach stdin. */
  write(data: string): void;

  /** Data received callback — reads from Docker attach stdout. */
  onData: (cb: (data: string) => void) => Disposable;

  /** Exit event callback — Docker container die event. */
  onExit: (cb: (e: { exitCode: number }) => void) => Disposable;

  /** Force-terminate process (container). */
  kill(): void;

  /** Resize terminal. No-op in headless. */
  resize(cols: number, rows: number): void;
}
```

### Implementation Mapping

| Pty method | DockerPty (production) | LocalPty (development) |
|-----------|---------------------|------------------|
| `spawn(file, args, opts)` | `docker create` + `start` + `attach` | `node-pty.spawn()` |
| `write(data)` | attach stdin stream | pty stdin |
| `onData(cb)` | attach stdout stream | pty stdout |
| `onExit(cb)` | Docker events API (die) | SIGCHLD |
| `kill()` | `docker kill` | `process.kill()` |
| `resize(cols, rows)` | no-op (headless) | `pty.resize()` |
| `pid` | container ID | OS PID |

### DockerPty Implementation

```typescript
function spawn(file: string, args: string[], options: PtyOptions): Pty {
  const container_id = docker.create({
    name: options.name,
    image: "soulflow/agent-runner:latest",
    cmd: [file, ...args],
    working_dir: options.cwd,
    env: options.env,
    stdin_open: true,
    // Security + resources
    memory: "512m",
    cpus: 1.0,
    network_mode: "none",
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges"],
    read_only: true,
    tmpfs: { "/tmp": "size=100m" },
    user: "1000:1000",
    pids_limit: 100,
    labels: {
      "sf.session_key": derive_session_key(options.name),
      "sf.cli": file,
    },
  });

  docker.start(container_id);
  const { stdin, stdout } = docker.attach(container_id, { stdin: true, stdout: true });

  return {
    pid: container_id,
    write: (data) => stdin.write(data),
    onData: (cb) => subscribe(stdout, "data", cb),
    onExit: (cb) => subscribe(docker.events(container_id, "die"), cb),
    kill: () => docker.kill(container_id),
    resize: () => {},
  };
}
```

---

## Gateway — Message Routing

Currently all channel messages reach agents via the same path. Gateway classifies messages first using a lightweight classifier (orchestrator LLM), routing to the appropriate execution path.

### Current Flow (direct)

```
Channel → ChannelManager → OrchestrationService → classify → AgentBackend.run()
```

### Proposed Flow (with Gateway)

```
Channel → Gateway → classification decision
                      ├─ PTY spawn   → ContainerCliAgent (complex tasks, multi-turn)
                      ├─ Native turn → ClaudeSdkAgent / OpenAiAgent (simple queries)
                      └─ Direct reply → immediate response without agent (FAQ, status)
```

### Gateway Design

```typescript
interface GatewayDecision {
  route: "pty_spawn" | "native_turn" | "direct_reply";
  backend_hint?: string;
  resource_profile?: "light" | "standard" | "heavy";
  direct_content?: string;
}

class Gateway {
  private classifier: PhiClassifier;

  async classify(message: InboundMessage, context: SessionContext): Promise<GatewayDecision> {
    const mode = await this.classifier.run({
      text: message.text,
      active_agents: context.active_agent_keys,
      recent_history: context.recent_messages,
    });

    switch (mode.execution_mode) {
      case "task":
      case "agent":
        return { route: "pty_spawn", resource_profile: "heavy" };
      case "once":
        return { route: "native_turn" };
      case "inquiry":
        return { route: "direct_reply", direct_content: mode.answer };
      case "builtin":
        return { route: "direct_reply" };
    }
  }
}
```

### Routing Criteria

| Classification | Route | Reason |
|---------------|-------|--------|
| **task/agent** | PTY spawn | Multi-turn tool usage, file modification, long tasks → container isolation needed |
| **once** | Native turn | Single API call sufficient, no tools or simple tools |
| **inquiry** | Direct reply | Active task status → DB query only |
| **builtin** | Direct reply | Slash command → delegate to existing handler |

### Relationship to OrchestrationService

Gateway extracts `classify_execution_mode()` out of OrchestrationService. OrchestrationService remains valid but narrows to **execution only**. Classification responsibility moves to Gateway.

---

## Layer 1: AgentBus (Communication)

Sole interface for inter-agent communication. Builds message patterns on top of the Pty interface.

### Communication Patterns

```typescript
class AgentBus {
  private transport: AgentTransport;
  private permissions: CommPermission[];
  private pending: Map<string, PendingRequest>;
  private lanes: Map<string, LaneQueue>;

  /** request/reply — ask another agent and wait for response. */
  async ask(from: string, to: string, content: string): Promise<string>;

  /** fire-and-forget — delegate work, don't wait. */
  async send(to: string, content: string): Promise<void>;

  /** broadcast — notify all agents. */
  async broadcast(content: string, filter?: (key: string) => boolean): Promise<void>;

  /** stream — real-time progress relay. */
  on(event: "agent_output", handler: (key: string, msg: AgentOutputMessage) => void): void;
}
```

### Lane Queue — Per-Session Message Serialization

When a new message arrives while an agent is executing, 3 modes are available:

```typescript
type LaneMode = "steer" | "followup" | "collect";

interface LaneQueue {
  /** Inject into currently executing agent immediately. */
  steer(session_key: string, content: string): Promise<void>;
  /** Queue as new turn after current turn completes. */
  followup(session_key: string, content: string): void;
  /** Collect messages for batch delivery. */
  collect(session_key: string, content: string): void;
  /** Drain queued messages. */
  flush(session_key: string): Promise<void>;
}
```

| Mode | Behavior | Use case |
|------|----------|----------|
| `steer` | Immediately write to running agent stdin | Urgent instructions, direction change |
| `followup` | Deliver after `complete` event as next turn | Follow-up questions, additional work |
| `collect` | Batch multiple messages into single delivery | Rapid successive inputs |

Default is **serial execution** — no concurrent turns within a session to prevent race conditions.

### Double-Nested Lane Serialization

Pi Execute Runner nests session and global lanes to prevent deadlocks:

```typescript
// Session lane: prevents concurrent mutations within the same session
const session_lane = resolve_session_lane(session_key);
// Global lane: prevents infrastructure-level resource contention
const global_lane = resolve_global_lane(lane_id);

return enqueue(session_lane, () =>
  enqueue(global_lane, async () => {
    // Both lanes must grant a slot before execution
    return run_attempt(session_key, prompt);
  })
);
```

**Lock acquisition order**: session → global (fixed order prevents deadlocks). FIFO queue serializes concurrent calls for the same session.

### AgentTransport — Transport Abstraction over Pty

```typescript
interface AgentTransport {
  write(session_key: string, msg: AgentInputMessage): Promise<void>;
  on_output(handler: (key: string, msg: AgentOutputMessage) => void): void;
  list_agents(): string[];
}

class PtyTransport implements AgentTransport {
  private ptys: Map<string, Pty>;

  async write(session_key: string, msg: AgentInputMessage): Promise<void> {
    this.ptys.get(session_key)!.write(JSON.stringify(msg) + "\n");
  }

  on_output(handler): void {
    for (const [key, pty] of this.ptys) {
      pty.onData((data) => {
        for (const line of data.split("\n").filter(Boolean)) {
          const msg = parse_ndjson(line);
          if (msg) handler(key, msg);
        }
      });
    }
  }
}
```

### Communication Flow (ask_agent)

```
Agent A                AgentBus               Agent B
  │                  (orchestrator)              │
  │ ask_agent_request    │                       │
  ├─────────────────────→│ 1. Permission check   │
  │                      │ 2. Logging            │
  │                      │ 3. pty.write()        │
  │                      ├──────────────────────→│
  │                      │    ask_agent_request   │
  │                      │                       │
  │                      │←──────────────────────┤
  │                      │    ask_agent_response  │
  │   ask_agent_response │ 4. Pending resolve    │
  │←─────────────────────┤ 5. Logging            │
```

### Permission Matrix

```typescript
type CommPermission = {
  from: string;
  to: string;
  allowed: boolean;
  max_depth?: number;  // Chain depth limit (prevent A→B→C infinite loops)
};
```

---

## Layer 2: ContainerPool (Management)

Manages Pty instance lifecycle. Controls containers through Docker API.

### ContainerPool

```typescript
class ContainerPool {
  private ptys = new Map<string, Pty>();
  private docker: DockerOps;
  private adapter: CliAdapter;

  async ensure_running(session_key: string): Promise<Pty> {
    if (this.ptys.has(session_key)) return this.ptys.get(session_key)!;
    const pty = spawn(
      this.adapter.cli_id,
      this.adapter.build_cmd(session_key),
      { name: to_container_name(session_key), cwd: "/workspace", ... }
    );
    this.ptys.set(session_key, pty);
    pty.onExit(() => this.ptys.delete(session_key));
    return pty;
  }

  async cleanup(max_idle_ms: number): Promise<void>;
  async reconcile(): Promise<void>;
}
```

### DockerOps — Docker API Abstraction

```typescript
interface DockerOps {
  create(opts: ContainerCreateOpts): Promise<string>;
  start(id: string): Promise<void>;
  attach(id: string): Promise<{ stdin: Writable; stdout: Readable }>;
  stop(id: string, timeout_s?: number): Promise<void>;
  kill(id: string): Promise<void>;
  rm(id: string): Promise<void>;
  inspect(id: string): Promise<ContainerInfo>;
  list(filters: Record<string, string[]>): Promise<ContainerInfo[]>;
  stats(id: string): Promise<ContainerStats>;
  events(filters: Record<string, string[]>): AsyncIterable<DockerEvent>;
}
```

### Container Lifecycle

| Event | Action |
|-------|--------|
| **Create** | `spawn()` → `docker create` + `start` + `attach` |
| **Idle cleanup** | `max_idle_ms` exceeded → `kill()` + `docker rm` |
| **Error recovery** | `onExit` callback → remove from pool, respawn on next request |
| **Orchestrator restart** | `docker ps --filter label=sf.session_key` → `docker attach` → rebuild Pty instances |

---

## Security Model

### Docker Socket Proxy

```yaml
services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CONTAINERS: 1
      IMAGES: 0
      NETWORKS: 0
      VOLUMES: 0
      POST: 1

  orchestrator:
    environment:
      DOCKER_HOST: tcp://docker-proxy:2375
```

### Agent Container Isolation

All security settings are included in `spawn()` container creation options:

| Security measure | Setting |
|-----------------|---------|
| Linux capabilities | `--cap-drop ALL` |
| Privilege escalation | `--security-opt no-new-privileges` |
| Root filesystem | `--read-only` |
| Execution user | `--user 1000:1000` |
| Process limit | `--pids-limit 100` |
| Network | `--network none` |
| Filesystem | volume mount scope only |

### Multi-Layer Defense

```
Layer 1 (Gateway)   : Lightweight classification — prevent unnecessary PTY spawns
Layer 2 (AgentBus)  : Communication permission matrix
Layer 3 (AgentBus)  : Tool filtering — expose only role-permitted tools
Layer 4 (Docker)    : Filesystem — no access outside volume mount scope
Layer 5 (Docker)    : Network — network:none → cannot bypass orchestrator
Layer 6 (Docker)    : Resources — memory/cpu limits prevent DoS
Layer 7 (Proxy)     : Docker socket — API whitelist
```

`network_mode: none` → **agent's only external communication path is `Pty.write()`/`onData()`**. Even if prompt injection bypasses Layers 2-3, Layers 4-7 block at OS level.

### Secret Management

```yaml
services:
  agent-butler:
    secrets:
      - anthropic_api_key   # /run/secrets/ (in-memory tmpfs)
```

Use Docker secrets instead of passing via `env` in `spawn()`.

---

## NDJSON Wire Protocol

Communication via `Pty.write()`/`onData()` uses line-delimited JSON (NDJSON).

### Input Messages (orchestrator → container)

```typescript
type AgentInputMessage =
  | { type: "user_message"; content: string; metadata?: Record<string, unknown> }
  | { type: "ask_agent_request"; from: string; content: string; request_id: string };
```

### Output Messages (container → orchestrator)

```typescript
type AgentOutputMessage =
  | { type: "assistant_chunk"; content: string; delta: true }
  | { type: "assistant_message"; content: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "complete"; result: string; usage?: { input: number; output: number } }
  | { type: "error"; code: "timeout" | "crash" | "token_limit"; message: string };
```

### CLI-Specific Output Formats

Each CLI has its own output format. The `CliAdapter.parse_output()` maps to `AgentOutputMessage`.

**Claude Code** (`--output-format stream-json`):
```jsonl
{"type":"system","subtype":"init","session_id":"550e8400-..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello! How"}]}}
{"type":"result","result":"Hello! How can I help?","session_id":"550e8400-..."}
```

Adapter mapping:
| Claude Code event | AgentOutputMessage |
|---|---|
| `{"type":"system","subtype":"init"}` | (internal — store session_id) |
| `{"type":"assistant","message":{...}}` | `{"type":"assistant_chunk", ...}` |
| `{"type":"result","result":"..."}` | `{"type":"complete","result":"..."}` |

### Turn Boundaries

- `complete` or `error` events mark the **end of a turn**
- NDJSON parsing: `\n` delimited, empty lines ignored, JSON parse failures skip + warning log

> For detailed concurrency policy (queuing, deadlock prevention), see [Phase Loop Design — §3 ask_agent Concurrency Policy](./phase-loop.md#3-ask_agent-concurrency-policy).

---

## Subagent Containerization

### Current Structure (per-iteration spawn)

```
_run_subagent(iterations=15)
  for iteration in 0..15:
    controller.plan(task, last_output)  ← orchestrator LLM
    executor.run(plan.executor_prompt)  ← new process each time
    last_output = executor.result       ← previous context lost
```

### Container Structure (persistent executor)

```
_run_subagent(iterations=15)
  pty = pool.ensure_running(subagent:{id})
  for iteration in 0..15:
    controller.plan(task, last_output)
    pty.write(plan.executor_prompt)       ← write to same Pty
    last_output = wait_for_complete(pty)  ← context preserved
  pty.kill()
```

### spawn_and_wait → spawn_and_converse

```typescript
// Current: one-shot fire-and-forget
spawn_and_wait(task) → result → process exits

// Container: conversable agent
const pty = spawn("claude", ["--headless", ...], { name: "agent-task-42", ... });
pty.write(task);
pty.onData((data) => { /* receive results */ });
// ... additional conversation ...
pty.write(followup);
// ... after completion ...
pty.kill();
```

---

## Agent Runner Image

```dockerfile
FROM node:22-slim

RUN npm install -g @anthropic-ai/claude-code@latest
RUN npm install -g @openai/codex@latest

WORKDIR /workspace
ENTRYPOINT []
```

`spawn(file, args)` passes `file` and `args` as the container CMD.

---

## Execution Loop — Retry + Compaction + Auth Rotation + Failover

ContainerCliAgent doesn't just forward requests. It **auto-recovers based on error classification**. (Reference: OpenClaw Pi Execute Runner `run.ts`)

### Dynamic Retry Cap

Instead of a fixed `MAX_ATTEMPTS`, the cap scales proportionally to auth profile count:

```typescript
const BASE_RETRY = 24;
const PER_PROFILE = 8;

function resolve_max_iterations(profile_count: number): number {
  const scaled = BASE_RETRY + Math.max(1, profile_count) * PER_PROFILE;
  return Math.min(160, Math.max(32, scaled));  // range: [32, 160]
}
```

1 profile → 32 iterations, 17 profiles → 160 (capped). Retry budget scales with infrastructure.

### Execution Loop (detailed)

```typescript
async run(options: AgentRunOptions): Promise<AgentRunResult> {
  const max_iterations = resolve_max_iterations(this.auth_profiles.length);
  let iteration = 0;
  let compaction_attempts = 0;
  let tool_truncation_attempted = false;
  const attempted_thinking = new Set<ThinkingLevel>();

  while (iteration++ < max_iterations) {
    const pty = await this.pool.ensure_running(options.session_key);
    const result = await this.bus.send_and_wait(options.session_key, options.prompt);

    if (result.type === "complete") {
      await this.mark_profile_good(this.current_profile);
      return result;
    }

    const error_class = classify_error(result);

    // ── Branch 1: Context Overflow → 3-stage recovery pipeline ──
    if (error_class === "context_overflow") {
      if (compaction_attempts < MAX_COMPACTION_ATTEMPTS) {
        const compacted = await this.compact(options.session_key);
        if (compacted) { compaction_attempts++; continue; }
      }
      if (!tool_truncation_attempted) {
        tool_truncation_attempted = true;
        const truncated = await this.truncate_oversized_tool_results(options.session_key);
        if (truncated) continue;
      }
      return { type: "error", code: "token_limit", message: "Context overflow after recovery attempts" };
    }

    // ── Branch 2: Auth Error → profile rotation ──
    if (error_class === "auth_error") {
      await this.mark_profile_failure(this.current_profile, "auth");
      const rotated = await this.advance_auth_profile();
      if (rotated) { attempted_thinking.clear(); continue; }
      // All profiles exhausted → model-level failover
      if (this.fallback_configured) {
        throw new FailoverError(result.message, { reason: "auth", provider: this.provider });
      }
      return { type: "error", code: "auth", message: "All auth profiles exhausted" };
    }

    // ── Branch 3: Rate Limit → backoff (timeout does NOT mark profile cooldown) ──
    if (error_class === "rate_limit") {
      await delay(exponential_backoff(iteration));
      continue;
    }

    // ── Branch 4: Crash → respawn container ──
    if (error_class === "crash") {
      await this.pool.remove(options.session_key);
      continue;
    }

    // ── Branch 5: Failover → profile rotation then model switch ──
    if (error_class === "failover") {
      await this.mark_profile_failure(this.current_profile, classify_failover_reason(result));
      const rotated = await this.advance_auth_profile();
      if (rotated) continue;
      if (this.fallback_configured) {
        throw new FailoverError(result.message, { reason: "unknown", provider: this.provider });
      }
    }

    // ── Unrecoverable ──
    throw new AgentError(result.message);
  }
  throw new AgentError("max iterations exceeded");
}
```

### Context Overflow Recovery Pipeline

```
overflow detected
  ├─ compaction attempt (max 3)
  │   ├─ success → retry
  │   └─ failure or count exhausted ↓
  ├─ tool result truncation (max 1)
  │   ├─ success → retry
  │   └─ failure ↓
  └─ give up (recommend /reset or larger model to user)
```

Key: tool result truncation does NOT reset compaction count — prevents infinite loops.

### Auth Profile Rotation

```typescript
async advance_auth_profile(): Promise<boolean> {
  if (this.locked_profile) return false;       // locked profiles never rotate
  let next = this.profile_index + 1;
  while (next < this.profile_candidates.length) {
    const candidate = this.profile_candidates[next];
    if (is_in_cooldown(candidate)) { next++; continue; }   // skip cooled-down
    try {
      await this.apply_auth(candidate);
      this.profile_index = next;
      return true;
    } catch { next++; }
  }
  return false;   // all profiles exhausted
}
```

- On rotation success: reset thinking level + clear attempted set
- Timeouts do NOT mark profile cooldown (model/network issue, not auth)
- On success completion: `mark_profile_good()` clears cooldown

### Model Failover — Delegated to Outer Orchestrator

`ContainerCliAgent` does NOT switch models directly. When all profiles are exhausted, it throws `FailoverError`, and the outer orchestrator advances to the next model.

```typescript
class FailoverError extends Error {
  constructor(message: string, public readonly meta: {
    reason: "auth" | "rate_limit" | "quota" | "timeout" | "unknown";
    provider: string;
    model?: string;
    profile_id?: string;
  }) { super(message); }
}
```

**Conditions that trigger FailoverError:**
1. Auth profiles exhausted + `fallback_configured`
2. Failover error + profiles exhausted + `fallback_configured`

**Handled internally (no throw):**
- Context overflow → compaction/truncation
- Crash → container respawn
- Rate limit → backoff

### Context Window Guard — Pre-flight Check

Before entering the retry loop, verify the model's context window meets minimum requirements:

```typescript
const guard = evaluate_context_window_guard({
  info: context_info,
  hard_min_tokens: 8_000,
  warn_below_tokens: 16_000,
});
if (guard.should_block) {
  throw new FailoverError(
    `Model context window too small (${guard.tokens} tokens)`,
    { reason: "unknown", provider }
  );
}
```

### Error Classification

```typescript
type ErrorClass =
  | "context_overflow"  // context exceeded
  | "auth_error"        // API key/auth failure
  | "rate_limit"        // rate limited or timeout
  | "crash"             // container abnormal exit
  | "failover"          // model-level switch needed
  | "billing"           // billing limit exceeded
  | "fatal";            // unrecoverable

function classify_error(msg: AgentOutputMessage): ErrorClass {
  if (msg.type !== "error") return "fatal";
  const text = msg.message ?? "";

  // Pattern matching — refined classification from Pi Execute Runner
  if (msg.code === "token_limit" || /context.*overflow|prompt.*too.*large/i.test(text))
    return "context_overflow";
  if (/invalid.*api.*key|unauthorized|authentication/i.test(text))
    return "auth_error";
  if (/rate.*limit|too.*many.*requests/i.test(text))
    return "rate_limit";
  if (/billing|quota.*exceeded|insufficient.*funds/i.test(text))
    return "billing";
  if (msg.code === "crash")
    return "crash";
  if (/failover|model.*unavailable|overloaded/i.test(text))
    return "failover";
  return "fatal";
}
```

---

## Backend Architecture

```
AgentBackend
  ├─ ContainerCliAgent       ← unified headless CLI (claude, codex, etc.)
  │   ├─ AgentBus            (comms — over Pty interface + Lane Queue)
  │   ├─ ContainerPool       (mgmt — spawn/kill/reconcile)
  │   ├─ CliAdapter          (absorbs per-CLI differences)
  │   └─ RetryLoop           (error classify → compact/rotate/backoff/respawn)
  │
  ├─ ClaudeSdkAgent          (native SDK)
  ├─ CodexAppserverAgent     (native AppServer)
  └─ OpenAiCompatibleAgent   (HTTP API)
```

### CliAdapter — Absorbing Per-CLI Differences

```typescript
interface CliAdapter {
  readonly cli_id: string;
  build_cmd(session_key: string): string[];
  parse_output(line: string): AgentOutputMessage | null;
  format_input(msg: AgentInputMessage): string;
}
```

### Pty Implementation Swap

```
Pty interface (spawn/write/onData/onExit/kill)
  ├─ DockerPty   ← production (Docker containers)
  └─ LocalPty    ← development (node-pty, no Docker)
```

Upper layers (AgentBus, ContainerPool) depend only on the `Pty` interface. Unaware of Docker vs local PTY.

---

## Design Challenges

| Challenge | Approach |
|-----------|----------|
| **Completion detection** | NDJSON `{"type":"complete"}` event + `onData` callback |
| **Concurrency** | AgentBus: request_queue (depth 3, timeout 30s) |
| **Idle cleanup** | ContainerPool: `max_idle_ms` exceeded → `kill()` + `docker rm` |
| **Error recovery** | `onExit` callback → remove from pool → `spawn()` on next request |
| **Orchestrator restart** | `docker ps --filter` → `docker attach` → rebuild Pty instances |
| **Resource limits** | `spawn()` options: memory, cpus, pids_limit |
| **Security** | Docker socket proxy + `network:none` + `--cap-drop ALL` |
| **Dev environment** | LocalPty (node-pty) — same interface without Docker |

## Related Docs

→ [Phase Loop Design](./phase-loop.md) — ideal use case for container agents
→ [Agent System](../core-concepts/agents.md)
→ [Provider Configuration Guide](../guide/providers.md)
