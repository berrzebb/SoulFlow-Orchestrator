# Agents

SoulFlow's agent system has two layers: **backends** (execution engines) and **role skills** (behavioral guidelines).

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

### Agent Loop (Standard)

Message → agent execution → response. The vast majority of requests use this mode.

### Task Loop (Stepwise)

Breaks long tasks into steps and reports progress at each stage.

```
/task list              # list running tasks
/task cancel <id>       # cancel a task
```

## MCP Integration

Connect Model Context Protocol servers so agents can use external tools.

Define your server list in `workspace/mcp-servers.json`, then enable MCP from the dashboard → **Settings**.

## Related Docs

→ [Channels](./channels.md)
→ [Skills System](./skills.md)
→ [Provider Configuration Guide](../guide/providers.md)
