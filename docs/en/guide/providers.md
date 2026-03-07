# Provider Configuration

Manage agent backend instances from the dashboard → **Providers** page.

## What Is a Provider?

A provider is an LLM backend instance the agent uses. You can create multiple instances of the same provider type (e.g., `claude_sdk`) with different priorities.

## Adding a Provider

1. **Providers page** → click `Add`
2. Fill in the form:

| Field | Description | Example |
|-------|-------------|---------|
| Provider Type | Backend engine | `claude_sdk` |
| Instance ID | Unique identifier (auto-generated) | `claude_sdk` |
| Label | Display name | `Primary Claude` |
| Enabled | Whether active | ✓ |
| Priority | Higher = selected first (0–100) | `10` |
| API Token | API key for this backend | `sk-ant-...` |
| Supported Modes | Which execution modes to allow | `once`, `agent`, `task`, `phase` |

3. Click `Add` to save

## Testing the Connection

Click the **Test** button on any provider card to verify the connection with a live API call.

- ✅ Pass — connected successfully
- ❌ Fail — check token or network

## Priority and Fallback

The instance with the highest priority is selected first. If that instance's CircuitBreaker is `open`, the next instance takes over automatically.

```
Priority 90: claude_sdk (open → blocked)
Priority 50: claude_cli (closed → selected)
Priority 10: openrouter (standby)
```

## CircuitBreaker States

| State | Display | Meaning |
|-------|---------|---------|
| `closed` | No badge | Normal |
| `half_open` | ⚠ Orange badge | Recovery in progress |
| `open` | ✗ Red badge | Blocked (auto-fallback active) |

`open` automatically transitions back through `half_open` over time.

## Backend Types

| Backend | Mode | Features | Auto Fallback |
|---------|------|----------|---------------|
| `claude_sdk` | Native SDK | Built-in tool loop · streaming | → `claude_cli` |
| `claude_cli` | Headless CLI wrapper | Stability · general purpose | — |
| `codex_appserver` | Native AppServer | Parallel execution · built-in tool loop | → `codex_cli` |
| `codex_cli` | Headless CLI wrapper | Sandbox mode support | — |
| `gemini_cli` | Headless CLI wrapper | Gemini CLI integration | — |
| `openai_compatible` | OpenAI-compatible API | vLLM · Ollama · LM Studio · Together AI · Gemini and other local/remote models | — |
| `openrouter` | OpenRouter API | Multi-model routing · 100+ model access | — |
| `container_cli` | Container CLI wrapper | Docker/Podman sandboxed isolation | — |

### Container CLI Backend

`container_cli` runs each agent in an isolated Docker/Podman container. Abstracted through a Pty (node-pty compatible) interface — upper layers are transport-agnostic.

**Architecture**:
```
Orchestrator
  ├─ Gateway (lightweight classifier → execution path decision)
  ├─ AgentBus (inter-agent communication · permission matrix)
  └─ ContainerPool (container lifecycle management)
       └─ Docker/Podman API
            ├─ concierge container
            ├─ implementer container
            └─ reviewer container
```

**Container security**:

| Security Measure | Configuration |
|-----------------|---------------|
| Linux capabilities | `--cap-drop ALL` |
| Privilege escalation | `--security-opt no-new-privileges` |
| Root filesystem | `--read-only` |
| Execution user | `--user 1000:1000` |
| Process limit | `--pids-limit 100` |
| Network | `--network none` — agent's only external communication path is Pty |
| Memory | `512m` default limit |

**Automatic error recovery**:

| Error Type | Recovery Strategy |
|-----------|------------------|
| Context overflow | 3-stage: compaction → tool result truncation → give up |
| Auth error | Auth profile rotation → model failover when exhausted |
| Rate limit | Exponential backoff |
| Crash | Container recreation |
| Failover | Profile rotation → FailoverError throw |

**NDJSON wire protocol**: Container and orchestrator communicate via line-delimited JSON (NDJSON). `{"type":"complete"}` marks the end of a turn.

**Lane Queue**: Three modes for handling messages arriving while an agent is running:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `steer` | Immediately inject into running agent | Urgent directives, course correction |
| `followup` | Queue for next turn after current completion | Follow-up questions, additional tasks |
| `collect` | Batch multiple messages for delivery | Combining rapid successive inputs |

### Fallback Chains

Built-in automatic fallback: `claude_sdk` → `claude_cli`, `codex_appserver` → `codex_cli`. When a native backend fails, it auto-switches to the CLI wrapper. Check `backend_fallback` logs to confirm.

## Supported Modes

| Mode | Description |
|------|-------------|
| `once` | Single-turn response — simple queries handled with a single API call |
| `agent` | Agent Loop — multi-turn tool execution, single agent iterates until task completion |
| `task` | Task Loop — stepwise long-running execution, sequential `TaskNode[]` with checkpoint-based progression |
| `phase` | Phase Loop — multi-agent phased workflow, parallel execution within phases + critic review |

Providers with a mode unchecked are excluded from that mode.

### Phase Loop Mode Details

Phase Loop activates in `phase` mode. The orchestrator classifier determines `phase` under these conditions:

- User explicitly requests via `/workflow` command
- Workflow created from the dashboard Workflows page
- Requests requiring multiple experts to analyze/work in parallel then synthesize
  - Examples: "Do market research", "Review this entire project", "Competitor analysis + tech analysis + strategy"

When using Phase Loop, different providers can be specified per agent in workflow definitions:

```yaml
agents:
  - role: Market Analyst
    backend: openrouter        # Uses OpenRouter
    model: gpt-5.1-codex-max
  - role: Tech Analyst
    backend: openai_compatible # Uses local vLLM
    model: qwen-72b
```

### Gateway Routing

The orchestrator classifier routes messages to the appropriate execution path:

| Classification | Route | Reason |
|---------------|-------|--------|
| `task` / `agent` | PTY spawn (container) | Multi-turn tool use, file modification → isolation needed |
| `once` | Native turn (SDK/API) | Single API call sufficient |
| `inquiry` | Direct reply | Answerable with DB query alone |
| `builtin` | Direct reply | Slash command → existing handler |
| `phase` | Phase Loop runner | Multi-agent workflow execution |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `Test` fails | Verify API token validity |
| Circuit breaker stuck `open` | Renew token, toggle Enable off and on |
| No response | Confirm a high-priority instance is enabled |
| SDK backend failure | Check `backend_fallback` logs (`claude_sdk` → `claude_cli` auto-switch) |
| Container execution failure | Check Docker/Podman daemon status, verify image pull |
| LLM runtime check | Run `npm run health:llm` |

## Related Docs

→ [Agent System](../core-concepts/agents.md)
→ [Dashboard Guide](./dashboard.md)
