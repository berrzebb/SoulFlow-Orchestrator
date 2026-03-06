# Installation & Setup

## Requirements

| Item | Condition |
|------|-----------|
| Docker or Podman | Container runtime (recommended) |
| Channel Bot Token | At least one of Slack · Telegram · Discord |
| AI Provider API Key | Claude, OpenAI, OpenRouter, etc. |
| (Optional) GPU | For local Ollama orchestrator LLM classifier |

## Docker (Recommended)

The recommended way to run SoulFlow is via Docker Compose. The `full` image includes Claude Code, Codex CLI, and Gemini CLI pre-installed.

### Production

```bash
docker compose up -d
```

This starts 3 services:
- **orchestrator** — SoulFlow runtime + dashboard (port 4200)
- **ollama** — Local LLM for request classification (GPU-accelerated)
- **docker-proxy** — Secure Docker socket proxy for container agent isolation

### Development (Live Reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Source files are mounted via volume — code changes are reflected automatically.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `4200` | Dashboard port mapping |
| `WORKSPACE_PATH` | `./workspace2` | Host path for persistent workspace data |

### Container Architecture

```
docker-compose.yml
  ├─ docker-proxy     ← Secure Docker socket proxy (POST-only, containers-only)
  ├─ ollama           ← Orchestrator LLM (GPU passthrough, 6GB memory limit)
  └─ orchestrator     ← SoulFlow runtime (full image with CLI agents)
       ├─ /data       ← Workspace volume (config, runtime DBs, skills)
       ├─ cli-auth-*  ← CLI OAuth token persistence (Claude, Codex, Gemini)
       └─ port 4200   ← Dashboard + API
```

### Dockerfile Stages

| Stage | Purpose |
|-------|---------|
| `deps` | Install Node.js dependencies + native builds (better-sqlite3) |
| `build` | Compile TypeScript + Vite frontend build |
| `production` | Minimal runtime image (node:22-slim + python3 + tini) |
| `full` | Production + Claude Code, Codex CLI, Gemini CLI pre-installed |
| `dev` | Development image with devDependencies + watch mode |

---

## Local (Not Recommended)

> Local installation is not recommended. Container deployment provides CLI agent isolation, consistent environments, and simpler setup. Use local only for development or when containers are unavailable.

### Requirements

| Item | Version |
|------|---------|
| Node.js | 20 or above |

### Install & Run

```bash
cd next
npm install

# Development (hot reload)
npm run dev

# Production
npm run build
cd workspace && node ../dist/main.js
```

---

## Initial Setup via Setup Wizard

On first launch, if no provider is configured, the dashboard automatically redirects to the **Setup Wizard** (`/setup`).

```
http://127.0.0.1:4200
```

The wizard guides you through:
1. **AI Provider** — Enter Claude/Codex API key
2. **Channels** — Enter Slack/Telegram/Discord Bot Token
3. **Agent Settings** — Select default role and backend

All configuration is handled through the Wizard — no `.env` file needed.

## Verify It Works

1. **Open dashboard** — `http://127.0.0.1:4200`
2. **Test in channel** — type `/status` in chat
3. **Self-diagnosis** — type `/doctor` and review any issues

## Channel Bot Setup

### Slack

1. [api.slack.com/apps](https://api.slack.com/apps) → Create app
2. Enable **Socket Mode** → Generate App-Level Token (`xapp-...`)
3. Add **OAuth Scopes**: `chat:write`, `channels:history`, `groups:history`, `im:history`
4. **Event Subscriptions** → Subscribe to `message.channels`, `message.groups`, `message.im`
5. Install to workspace → Copy Bot Token (`xoxb-...`)
6. Enter token in the dashboard **Setup Wizard** or **Channels** page

### Telegram

1. [@BotFather](https://t.me/botfather) → `/newbot` to create a bot
2. Enter token in the dashboard **Setup Wizard** or **Channels** page

### Discord

1. [discord.com/developers](https://discord.com/developers/applications) → Create application
2. Bot tab → Generate token, enable **Message Content Intent**
3. Invite bot via OAuth2 URL (permissions: `Send Messages`, `Read Message History`)
4. Enter token in the dashboard **Setup Wizard** or **Channels** page

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `another instance is active` | Stop other process using the same token |
| No response | Verify token/chat ID, run `/doctor` |
| Dashboard unreachable | Check `DASHBOARD_PORT`, or stop the conflicting process |
| SDK backend fails | Check log for `backend_fallback` (auto-fallback to CLI) |
| Container won't start | Verify Docker/Podman daemon is running, check `docker compose logs` |
| Ollama not responding | Check GPU availability, run `docker compose logs ollama` |

## Next Steps

→ [Dashboard Guide](../guide/dashboard.md)
→ [Understanding Channels](../core-concepts/channels.md)
→ [Choosing an Agent Backend](../core-concepts/agents.md)
