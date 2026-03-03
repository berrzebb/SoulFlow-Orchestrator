# Dashboard

Web-based management UI accessible at `http://127.0.0.1:4200`.

Navigate between 7 sections via the sidebar. Toggle dark/light theme with the button at the bottom of the sidebar.

## Pages

| Page | Path | Function |
|------|------|----------|
| Overview | `/` | Runtime status summary, system metrics, SSE live feed |
| Workspace | `/workspace` | Memory · sessions · skills · cron · tools · agents · templates · OAuth (8 tabs) |
| Chat | `/chat` | Web-based agent conversation |
| Channels | `/channels` | Channel connection status · global settings |
| Providers | `/providers` | Agent provider CRUD |
| Secrets | `/secrets` | AES-256-GCM secret management |
| Settings | `/settings` | Global runtime settings |

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
- Filter by channel
- Click session → full message history

### Skills
View and edit agent skill files.
- **Builtin skills**: read-only (built-in role skills)
- **Workspace skills**: directly edit `SKILL.md` and `references/` files
- Switch file tabs, click Save to persist — changes take effect immediately (no restart)

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

The Overview page shows real-time events via SSE (Server-Sent Events).

- Agent start/complete
- Task step transitions
- Channel message received
- Circuit breaker state changes

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
