# Agents

SoulFlow's agent system has two layers: **backends** (execution engines) and **role skills** (behavioral guidelines), with orchestration managing lifecycle, concurrency, and safety.

## Agent Backends

The execution engines that actually process messages.

| Backend | Method | Strengths | Auto Fallback |
|---------|--------|-----------|---------------|
| `claude_sdk` | Native SDK | Streaming, built-in tool loop | → `claude_cli` |
| `claude_cli` | Headless CLI wrapper | Stable, general-purpose | — |
| `codex_appserver` | Native AppServer | Parallel execution, built-in tool loop | → `codex_cli` |
| `codex_cli` | Headless CLI wrapper | Sandbox mode support | — |

### Choosing a Backend

- **Streaming matters** → `claude_sdk` (fastest first token)
- **Stability first** → `claude_cli` (batch/production)
- **Using Codex/OpenAI** → `codex_appserver` or `codex_cli`

Register multiple backends with priorities in the dashboard → **Providers** page.

### CircuitBreaker

When a backend fails repeatedly, the circuit breaker activates.

```
closed (normal) → open (blocked) → half_open (recovery probe) → closed
```

When `open`, traffic is automatically shifted to a lower-priority backend. Current state is visible on dashboard provider cards.

## Role Skills

Specialized roles each agent can take on. The appropriate role is selected automatically based on the request.

| Role | Specialization | Delegates To |
|------|---------------|--------------|
| `butler` | Request intake · routing · single tool execution | → pm/pl/generalist |
| `pm` | Requirements analysis · task decomposition | → implementer |
| `pl` | Tech lead · architecture design | → implementer/reviewer |
| `implementer` | Code writing · feature implementation | — |
| `reviewer` | Code review · quality validation | — |
| `debugger` | Bug diagnosis · root cause analysis | — |
| `validator` | Output verification · regression testing | — |
| `generalist` | General-purpose handling | — |

### Delegation Flow

```
User message
  → butler (classify/route)
      → Simple Q&A / tool execution: butler handles directly
      → Complex implementation: pm → implementer → reviewer
      → Bug fix: debugger → validator
      → Architecture decision: pl → implementer
```

## Execution Modes

### Once Mode (Single Turn)

Message → single agent response. Used for simple questions and direct tool calls. Temperature 0.3, max 1,600 tokens. If the agent detects the task needs more depth, it escalates to agent or task loop.

### Agent Loop (Multi-Turn)

Continuous reasoning + tool execution loop. The agent keeps working until the task is complete or max turns is reached (default: 10). Supports thinking tokens (up to 16K) for complex reasoning.

### Task Loop (Stepwise)

Breaks long tasks into explicit phases: **plan → execute → finalize**. Each phase reports progress. Supports up to 40 turns by default. Tasks can pause for user input or approval, then resume.

```
/task list              # list running tasks
/task cancel <id>       # cancel a task
```

### Phase Loop (Workflow)

Multi-agent workflow with defined phases. Each phase can run agents in parallel. Supports critic review between phases.

## Subagent Management

When a task requires parallel work or delegation, the orchestrator spawns subagents.

### Concurrency

- **Max 10** concurrent subagents
- **Max 500** tracked references (older completed ones are auto-pruned)
- Each subagent gets its own execution context and tool set

### Execution Modes

| Mode | Use Case |
|------|----------|
| Controller-Executor | Orchestrator LLM decides turns, executor runs them (default) |
| Direct Executor | Single-turn execution for Phase Loops (`skip_controller`) |

### Cascade Cancellation

Cancelling a parent automatically cancels all child subagents. This prevents orphaned executions and resource waste.

### Stream Buffering

Subagent output is buffered and flushed every **1.5 seconds** or when the buffer exceeds **120 characters** — preventing rate limit spam while maintaining responsiveness.

### Handoff

Subagents can announce @mentions for task routing, enabling work to be passed between specialized agents.

## Approval Gates

Tool executions can be gated behind user approval. See [Security — Approval Workflow](./security.md#5-approval-workflow-hitl) for details.

In subagent sandbox mode, approvals are auto-granted to avoid blocking parallel execution.

## Agent Inspector

The Inspector service provides a unified API for querying and controlling agent runtime state.

### Capabilities

| Operation | Description |
|-----------|-------------|
| `list_active_loops()` | Running agent loops |
| `stop_loop(id, reason)` | Graceful loop termination |
| `list_runtime_tasks()` | Current execution tasks |
| `list_stored_tasks()` | Persisted task history |
| `list_subagents()` | Spawned subagents and status |
| `cancel_subagent(id)` | Cancel specific subagent |
| `send_input_to_subagent(id, text)` | Inject input to running subagent |
| `list_approval_requests(status)` | Pending/resolved approvals |
| `resolve_approval_request(id, text)` | Apply user decision |

### Dashboard Integration

All Inspector operations are exposed through the web dashboard, providing real-time visibility into agent activity, task progress, and approval queues.

## Request Classification

An orchestrator LLM classifies incoming requests into execution modes:

| Mode | When Selected |
|------|--------------|
| `once` | Simple questions, direct answers |
| `agent` | Multi-step reasoning needed |
| `task` | Long-running work with progress tracking |
| `inquiry` | Clarification needed before proceeding |
| `phase` | Multi-agent workflow required |

Fallback: If the orchestrator LLM is unavailable, requests default to `once` mode.

## MCP Integration

Connect Model Context Protocol servers so agents can use external tools.

Define your server list in `workspace/mcp-servers.json`, then enable MCP from the dashboard → **Settings**.

## Related Docs

→ [Security](./security.md)
→ [Channels](./channels.md)
→ [Skills System](./skills.md)
→ [Provider Configuration Guide](../guide/providers.md)
