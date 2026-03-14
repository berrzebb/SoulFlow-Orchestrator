# Dashboard

Web-based management UI accessible at `http://127.0.0.1:4200`.

Built with **React + Vite**. Supports **Korean/English i18n** (auto-detected from browser locale). Uses a CSS design token system (`var(--sp-*)`, `var(--fs-*)`, `var(--line)`, `var(--radius-*)`) for consistent theming.

Global state management via Zustand (`store.ts`) — SSE connection status, sidebar, theme, web streaming.

Navigate between 10 sections via the sidebar. Toggle dark/light theme with the button at the bottom of the sidebar.

## Setup Wizard

On first launch with no providers configured, the dashboard auto-redirects to `/setup`.

| Step | Content |
|------|---------|
| 1 | Select AI providers + enter API keys |
| 2 | Choose default executor/orchestrator |
| 3 | Enter agent alias |
| 4 | Complete → redirect to Overview after 1.5s |

## Pages

| Page | Path | Function |
|------|------|----------|
| Overview | `/` | Runtime status summary, system metrics, SSE live feed |
| Workspace | `/workspace` | Memory · sessions · skills · cron · tools · agents · templates · OAuth · models · references (10 tabs) |
| Chat | `/chat` | Web-based agent conversation (markdown rendering + code highlighting) |
| Channels | `/channels` | Channel connection status · global settings |
| Providers | `/providers` | Agent provider CRUD |
| Secrets | `/secrets` | AES-256-GCM secret management |
| Workflows | `/workflows` | Phase Loop workflow management · 141-node graph editor · agent chat |
| Kanban | `/kanban` | Drag-and-drop kanban board · automation rules |
| WBS | `/wbs` | Kanban card hierarchy tree view (parent_id-based) |
| Settings | `/settings` | Global runtime settings (section tabs, inline edit, ToggleSwitch) |

## Overview

View the entire runtime at a glance.

| Section | Content |
|---------|---------|
| **Stat cards** | Active agent count · running processes · connected channels |
| **Performance** | CPU · Memory · Swap usage (progress bars) |
| **Network** | Network RX/TX speed (KB/s) — Linux only |
| **Agents** | Role badges · last message time |
| **Running Processes** | run_id · mode · tool call count · error status |
| **Cron** | Active cron jobs (shown only when jobs exist) |
| **Decisions** | Key decisions (shown only when decisions exist) |
| **Recent Events** | Workflow event stream |

## Workspace Tabs

Workspace is organized in 10 tabs.

### Memory
View and edit the agent's memory and DB-backed records.

| Item | Content |
|------|---------|
| **Long-term** | Long-term memory (editable) |
| **Daily** | Daily notes by date (editable) |
| **Decisions** | Decision records stored in DB |
| **Promises** | Promise records stored in DB (add/delete) |
| **Events** | Workflow event stream from DB |

### Sessions
View conversation session list and message history.
- **Channel filter chips**: filter by All / Slack / Telegram / Discord / Web provider
- Click session → provider badge + full message history with timestamps

### Skills
View and edit agent skill files.
- **Builtin skills**: read-only (built-in role skills)
- **Workspace skills**: directly edit `SKILL.md` and `references/` files
- Switch file tabs, click Save to persist — changes take effect immediately (no restart)
- **Tool picker** (shown automatically when editing `SKILL.md`)
  - `Tools:` — click to toggle SoulFlow registry tools → updates `tools:` frontmatter
  - `SDK:` — Bash · Read · Write · Edit and other Claude Code native tools
  - `OAuth:` — click to toggle registered OAuth services → updates `oauth:` frontmatter
  - `Role preset:` — click a role button → bulk-merge that role's tool set

### Cron
Manage cron jobs — list, add, edit, delete, run now.

### Tools
Browse all tools available to agents.
- Tool name · source · parameter count
- **Click a row** → expand parameter table (name · type · required · description)

### Agents
Manage agent configurations — role · backend · add/edit/delete.

### Templates
Edit system prompt templates.
- Editable files: `AGENTS` · `SOUL` · `HEART` · `USER` · `TOOLS` · `HEARTBEAT`
- Changes take effect on the next agent execution

### OAuth
Manage OAuth 2.0 external service integrations → [OAuth Guide](./oauth.md)

### Models
Manage the orchestrator LLM runtime and models. The orchestrator is a lightweight classifier that determines the execution mode (`once`/`agent`/`task`/`phase`) for each user message. Hot-swap local LLMs (Phi-4, Qwen, DeepSeek, Gemma, etc.) used as the classifier — zero code changes required.

| Feature | Description |
|---------|-------------|
| **Model list** | All locally installed models — name, size, parameter count (e.g., 3.8B), quantization level (e.g., Q4_K_M) |
| **Pull** | Download models from the Ollama registry — streaming progress display |
| **Delete** | Remove models from disk (with confirmation) |
| **Switch** | Change the active classifier model — config update + automatic warmup |
| **VRAM monitor** | Currently VRAM-loaded models + memory usage |
| **Runtime status** | running/stopped · engine (`native`/`docker`/`podman`) · GPU utilization · API Base |

## Chat Page

Web-based agent conversation for testing without Slack/Telegram.

- **Markdown rendering**: Agent responses rendered with full GFM support (headings, bold, lists, tables, blockquotes)
- **Code highlighting**: Fenced code blocks with language-specific syntax highlighting (`highlight.js`)
- **Security**: `rehype-sanitize` blocks `<script>`, `<iframe>`, `javascript:` URLs and XSS vectors
- **Streaming**: Partial markdown rendered progressively as the agent streams
- **Approval banner**: Inline approve/deny UI for tool approval requests
- **Media preview**: File attachments rendered inline
- **Agent selector**: Switch between configured agents

## Providers Page

Manage agent backends with a two-level architecture: **Connections** (shared API base/auth) and **Provider Instances** (per-model configuration).

### Connections

A connection represents a shared API endpoint (e.g., one OpenRouter account). Multiple provider instances can share a single connection.

1. **Add** — new connection (provider type, label, API base URL)
2. **Edit** — modify connection settings
3. **Remove** — delete connection (cascades to linked providers)

### Provider Instances

Each instance configures a specific model within a connection.

1. **Add** — new provider (connection, model, priority, purpose, supported modes)
2. **Edit** — modify existing provider settings
3. **Test** — verify connection with a live API call
4. **Remove** — delete provider

Circuit breaker state (`closed` / `half_open` / `open`) is shown as a badge on each card.

## Workflows Page

Manage Phase Loop workflows and chat with agents. Phase Loop differs from Agent Loop (1:1 single agent) and Task Loop (sequential N:1) by implementing a **2-dimensional execution model: parallel agents within a phase + critic review → next phase**.

The Workflows page includes a **Graph Editor** with 141 node types across 6 categories (flow, data, AI, integration, interaction, advanced), a **Node Inspector** for editing node properties, and a **Node Picker** palette for drag-and-drop workflow construction.

### Comparison with Other Loops

| | Agent Loop | Task Loop | Phase Loop |
|---|---|---|---|
| Execution unit | Single prompt | Sequential nodes | Phase × parallel agents |
| Agent count | 1 | 1/step | N/phase + critic |
| Execution mode | Synchronous | Sequential | Parallel within phase, sequential between phases |
| Conversation | Single session | Single session | Independent session per agent |
| Quality gate | None | None | Critic review |

### Workflow List

Information displayed on workflow cards:
- **Title** · **Status** (`running` / `completed` / `failed` / `cancelled` / `waiting_user_input`)
- **Progress**: current phase / total phases, completed agent count
- **Agent count** · **Critic count**

### Workflow Detail View

Clicking a workflow opens the detail page:

- **Phase timeline**: Visual status of each phase (`pending` → `running` → `reviewing` → `completed`)
- **Agent card grid**: Per-agent status cards within a phase
  - Role · model · status badge
  - `[Result]` — View agent's final output
  - `[💬 Chat]` — Additional conversation with the agent
- **Critic card**: Critic's review after all agents complete
  - Approval status · feedback content
  - On rejection, user choices: Continue / Retry / Abort

### Agent Chat Panel

Clicking `[💬]` on an agent card opens a right slide panel. Each agent has an independent session, allowing users to have bidirectional conversations with individual agents.

- **Conversation history**: Full display of system prompt · agent responses · user messages
- **Inter-agent communication display**: `ask_agent` calls/responses shown with distinct styling
- **Real-time updates**: New messages auto-added via SSE `agent_message` events
- **Re-run**: Button to re-execute the agent with its initial prompt

Chat example:
```
User: "Competitor A is missing from the analysis, please add it"
Market Analyst: "Adding A Corp analysis. [Updated analysis results]"
→ agent.result updated, conversation recorded in agent.messages
```

### Inter-Agent Autonomous Communication

Agents within a phase can communicate directly via the `ask_agent` tool without going through the orchestrator:

```
Market Analyst → ask_agent("Tech Analyst", "What's the 3nm process status?")
← Tech Analyst: "TSMC N3E in mass production, Samsung 2nm GAA planned 2025..."
```

Safety measures:
- Call depth counter (`max_depth=3`) — prevents infinite loops
- Per-agent mutex — serializes concurrent requests
- Queue depth limit (≤3) + timeout (30s)
- Communication limited to agents within the same phase

### Workflow Definitions (YAML)

Define workflow templates as YAML files in the `workspace/workflows/` directory:

```yaml
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
        system_prompt: "Analyze tech stack, patents, and technology trends."
    critic:
      backend: openrouter
      system_prompt: "Review all analyses for logical consistency, data evidence, and gaps."
      gate: true

  - phase_id: strategy
    title: Strategy Development
    context_template: |
      ## Previous Phase Results
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - role: Strategist
        ...
```

### Phase Failure Policies

Configure per-phase behavior when some agents fail:

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `fail_fast` | Any failure → immediate phase failure | All agent results required |
| `best_effort` (default) | Continue with available agents | Research/analysis (partial gaps OK) |
| `quorum` | Proceed if ≥N agents succeed | Voting/consensus-based decisions |

### Critic Rejection Behavior

When a critic rejects, behavior depends on per-critic configuration:

| Strategy | Behavior |
|----------|----------|
| `retry_all` | Re-run all agents (inject critic feedback) |
| `retry_targeted` | Re-run only agents identified by critic |
| `escalate` (default) | Delegate to user — Continue / Retry / Abort |

### Dynamic Workflow Generation

When no matching YAML template exists, the classifier auto-generates a workflow:

1. Classifier determines `phase` mode
2. Searches `workspace/workflows/` → no match
3. Workflow planner auto-determines agent roles/count
4. Preview presented to user → execution only after approval (no auto-execution)

### Workflows API

| Endpoint | Function |
|----------|----------|
| `GET /api/workflows` | List workflows |
| `GET /api/workflows/:id` | Workflow detail (full `PhaseLoopState`) |
| `POST /api/workflows` | Create/execute workflow |
| `POST /api/workflows/:id/cancel` | Cancel workflow |
| `GET /api/workflows/:id/phases/:pid/agents/:aid/messages` | Get agent conversation |
| `POST /api/workflows/:id/phases/:pid/agents/:aid/messages` | Send message to agent |
| `POST /api/workflows/:id/phases/:pid/agents/:aid/retry` | Retry agent |
| `POST /api/workflows/:id/phases/:pid/critic/messages` | Send message to critic |

## Kanban Page

Manage task boards with drag-and-drop columns and automation rules.

- **Board management** — create/delete boards with customizable column layouts
- **Card operations** — create, move, archive cards with drag-and-drop
- **Real-time sync** — SSE-based live updates across all connected clients
- **Automation rules** — trigger actions on card events (e.g., auto-create task when card moves to "In Progress")
- **View modes** — board view (columns) or list view (table)
- **Filters** — active / all / backlog / done

### Automation Rules

Rules can trigger workflow executions or task creation based on Kanban events:

| Trigger | Description |
|---------|-------------|
| `card_moved` | Card moved to a specific column |
| `subtasks_done` | All subtasks on a card completed |
| `card_stale` | Card idle for a configured duration |

## WBS Page

Visualize kanban cards as a `parent_id`-based hierarchy tree. Use parent-child card relationships to view project structure in a Work Breakdown Structure format.

- **Tree view** — hierarchical display from top-level cards down to nested subtasks
- **Progress rollup** — child card completion rate aggregated to parent cards
- **Board integration** — shares the same card data as the Kanban board (no separate storage)
- **Quick navigation** — click a tree node to jump to the corresponding kanban card

## Secrets Page

Manage AES-256-GCM encrypted secrets.
- Secret list (values hidden)
- Add · delete · Reveal (confirm decrypted value)
- Agents access by reference only — actual values decrypted only in tool execution path

## Observability

SoulFlow includes a built-in observability layer for production monitoring and debugging.

### Execution Spans

Every agent execution is wrapped in a **span** — a structured record that captures the full lifecycle of a request:

| Field | Description |
|-------|-------------|
| `trace_id` | Correlation ID propagated from inbound message to final reply |
| `span_id` | Unique span identifier (each tool call, LLM inference, node gets its own span) |
| `parent_span_id` | Enables tree reconstruction for nested/subagent calls |
| `duration_ms` | Wall-clock duration |
| `status` | `ok` / `error` / `cancelled` |
| `attributes` | Provider, model, token usage, tool name, error type |

Spans are stored in `workspace/runtime/spans/spans.db` and viewable in dashboard → **Workspace** → **Events**.

### Metrics

The metrics sink collects runtime counters and histograms:

| Metric | Type | Description |
|--------|------|-------------|
| `agent.requests` | Counter | Total agent invocations per backend |
| `agent.latency_ms` | Histogram | End-to-end request latency |
| `agent.tokens_in` / `tokens_out` | Counter | Token usage per provider |
| `tool.calls` | Counter | Tool invocation count per tool name |
| `delivery.success` / `delivery.fail` | Counter | Outbound message delivery outcomes |

### Delivery Trace

Each outbound message carries a **delivery trace** — a record of the send attempt, retry count, and final status. The delivery trace links back to the originating span via `trace_id`, enabling end-to-end request correlation.

Failed deliveries appear in the Dead Letter Queue (DLQ) and are searchable by `trace_id`.

### Optional Exporters

Spans and metrics can be exported to external observability platforms. Configure in dashboard → **Settings** → `observability`:

| Exporter | Format | Config Key |
|----------|--------|-----------|
| OpenTelemetry Collector | OTLP/gRPC | `observability.otlp.endpoint` |
| Prometheus | Pull (scrape) | `observability.prometheus.enabled` |
| Console (debug) | Structured JSON | `observability.console.enabled` |

When no exporter is configured, spans and metrics are kept local in SQLite (retention: 7 days by default).

## Live Feed

The Overview page shows real-time events via SSE (Server-Sent Events). `SseManager` broadcasts the following events:

| SSE Event | Purpose |
|-----------|---------|
| `process` | Execution start/complete |
| `message` | Inbound/outbound messages (keeps last 40) |
| `cron` | Cron job events |
| `progress` | Progress updates |
| `task` | Task state changes |
| `web_stream` | Web chat streaming |
| `agent` | Agent events (slim fields only) |

Additional events during Phase Loop execution:

| SSE Event | Purpose |
|-----------|---------|
| `workflow_started` | Workflow execution started |
| `phase_started` / `phase_completed` | Phase start/completion |
| `agent_started` / `agent_completed` / `agent_failed` | Agent start/completion/failure |
| `agent_message` | Agent conversation message (real-time) |
| `critic_started` / `critic_completed` / `critic_rejected` | Critic review start/completion/rejection |
| `node_waiting` | Interaction node paused (approval, HITL, form) |
| `node_retry` | Node retry attempt (attempt count, max attempts, error) |
| `workflow_completed` / `workflow_failed` | Workflow completion/failure |

## Backend Architecture

The dashboard backend is split into these services:

| Service | Role |
|---------|------|
| `RouteContext` | Shared handler context (req/res + `json()`, `read_body()`, `add_sse_client()` action functions) |
| `SseManager` | SSE client management + 7-type event broadcast |
| `StateBuilder` | Pure functions for dashboard state assembly (`build_dashboard_state`, `build_merged_tasks`) |
| `StaticServer` | SPA static asset serving + `index.html` fallback (html: no-store, others: immutable) |
| `MediaTokenStore` | Token-based media serving (workspace path validation, 1-hour TTL) |
| `OpsFactory` | 13 domain ops factories (template, channel, agent-provider, bootstrap, memory, workspace, oauth, config, skill, tool, cli-auth, model, workflow) |

26 route handlers in `src/dashboard/routes/` — each follows the `async (ctx: RouteContext) => boolean` pattern.

## Access Control

By default, the server binds to `127.0.0.1` only. To allow external access, change the host and port in the dashboard → **Settings** → `dashboard` section.

> **Caution**: External binding exposes the dashboard without authentication.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Cannot connect | Change port in Settings or stop the conflicting process |
| Live feed disconnects | Refresh browser, check firewall/proxy for SSE blocking |
| Settings not saving | Check write permissions on `workspace/templates/` |

## Related Docs

→ [Provider Configuration](./providers.md)
→ [OAuth Integration](./oauth.md)
→ [Workflows Guide](./workflows.md)
→ [Heartbeat Setup](./heartbeat.md)
