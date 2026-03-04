# Dashboard

Web-based management UI accessible at `http://127.0.0.1:4200`.

Built with **React + Vite**. Supports **Korean/English i18n** (auto-detected from browser locale). Uses a CSS design token system (`var(--sp-*)`, `var(--fs-*)`, `var(--line)`, `var(--radius-*)`) for consistent theming.

Global state management via Zustand (`store.ts`) — SSE connection status, sidebar, theme, web streaming.

Navigate between 7 sections via the sidebar. Toggle dark/light theme with the button at the bottom of the sidebar.

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
| Workspace | `/workspace` | Memory · sessions · skills · cron · tools · agents · templates · OAuth (8 tabs) |
| Chat | `/chat` | Web-based agent conversation (markdown rendering + code highlighting) |
| Channels | `/channels` | Channel connection status · global settings |
| Providers | `/providers` | Agent provider CRUD |
| Secrets | `/secrets` | AES-256-GCM secret management |
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

Workspace is organized in 8 tabs.

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
- Editable files: `IDENTITY` · `AGENTS` · `SOUL` · `HEART` · `USER` · `TOOLS` · `HEARTBEAT`
- Changes take effect on the next agent execution

### OAuth
Manage OAuth 2.0 external service integrations → [OAuth Guide](./oauth.md)

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

Add, edit, delete, and test agent backends.

1. **Add** — new provider (type, token, priority, supported modes)
2. **Edit** — modify existing provider settings
3. **Test** — verify connection with a live API call
4. **Remove** — delete provider

Circuit breaker state (`closed` / `half_open` / `open`) is shown as a badge on each card.

## Secrets Page

Manage AES-256-GCM encrypted secrets.
- Secret list (values hidden)
- Add · delete · Reveal (confirm decrypted value)
- Agents access by reference only — actual values decrypted only in tool execution path

## Live Feed

The Overview page shows real-time events via SSE (Server-Sent Events). `SseManager` broadcasts 7 event types:

| SSE Event | Purpose |
|-----------|---------|
| `process` | Execution start/complete |
| `message` | Inbound/outbound messages (keeps last 40) |
| `cron` | Cron job events |
| `progress` | Progress updates |
| `task` | Task state changes |
| `web_stream` | Web chat streaming |
| `agent` | Agent events (slim fields only) |

## Backend Architecture

The dashboard backend is split into these services:

| Service | Role |
|---------|------|
| `RouteContext` | Shared handler context (req/res + `json()`, `read_body()`, `add_sse_client()` action functions) |
| `SseManager` | SSE client management + 7-type event broadcast |
| `StateBuilder` | Pure functions for dashboard state assembly (`build_dashboard_state`, `build_merged_tasks`) |
| `StaticServer` | SPA static asset serving + `index.html` fallback (html: no-store, others: immutable) |
| `MediaTokenStore` | Token-based media serving (workspace path validation, 1-hour TTL) |
| `OpsFactory` | 11 domain ops factories (template, channel, agent-provider, bootstrap, memory, workspace, oauth, config, skill, tool, cli-auth) |

22 route handlers in `src/dashboard/routes/` — each follows the `async (ctx: RouteContext) => boolean` pattern.

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
→ [Heartbeat Setup](./heartbeat.md)
