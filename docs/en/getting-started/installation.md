# Installation & Setup

## Requirements

| Item | Condition |
|------|-----------|
| Docker or Podman | Container runtime (recommended) |
| AI Provider API Key | Claude, OpenAI, OpenRouter, etc. |
| (Optional) Channel Bot Token | Slack · Telegram · Discord — Web chat available without any token |
| (Optional) GPU | For local Ollama orchestrator LLM classifier |

---

## Quick Start (5 minutes)

### Step 1: Clone the repository

```bash
git clone https://github.com/berrzebb/SoulFlow-Orchestrator.git
cd SoulFlow-Orchestrator
```

### Step 2: Start the environment

SoulFlow provides platform-specific run scripts:

**Linux/macOS:**
```bash
chmod +x run.sh
./run.sh prod --workspace=/path/to/your/workspace
```

**Windows (PowerShell):**
```powershell
.\run.ps1 prod --workspace=D:\your\workspace
```

**Windows (CMD):**
```cmd
run.cmd prod --workspace=D:\your\workspace
```

> `--workspace` is the path to a **persistent directory** where config files, runtime DBs, and skills are stored.
> If the path does not exist, it is created automatically.

### Step 3: Complete Setup Wizard in browser

```
http://localhost:4200
```

If no provider is configured, the dashboard automatically redirects to the **Setup Wizard** (`/setup`):

1. **AI Provider** — Enter Claude/OpenAI/OpenRouter API key
2. **Channels** — Enter Slack/Telegram/Discord Bot Token *(optional — Web chat works without any token)*
3. **Agent Settings** — Select default role and backend

All configuration is handled through the Wizard — no `.env` file needed.

### Step 4: Verify it works

Type the following in any chat channel:

```
/status   → View tool and skill list
/doctor   → Run self-diagnosis
```

---

## run.sh / run.ps1 / run.cmd Reference

### Commands

| Command | Description |
|---------|-------------|
| `dev` | Development environment (source mount + hot reload, port 4200) |
| `test` | Test environment (port 4201) |
| `staging` | Staging environment (port 4202) |
| `prod` | Production environment (`full` image, port 4200) |
| `build` | Build Docker image only |
| `down` | Stop all environments |
| `status` | Check running environment status |
| `logs [env]` | Stream logs (`logs prod`) |
| `login <agent>` | Agent CLI login (`login claude`) |

### Options

| Option | Description |
|--------|-------------|
| `--workspace=PATH` | Workspace path **(required)** |
| `--web-port=PORT` | Override dashboard port |
| `--instance=NAME` | Instance name (multi-instance scaling) |
| `--watch` | Full source mount + hot reload (tsx watch) |
| `--watch=web` | Web source only + Vite --watch |

### Environment Presets

| Environment | Image | NODE_ENV | Memory | CPU |
|-------------|-------|----------|--------|-----|
| `dev` | dev | development | 1G | 2 |
| `test` | production | test | 1G | 2 |
| `staging` | production | production | 1G | 2 |
| `prod` | full (with CLI agents) | production | 2G | 4 |

### Agent Login

CLI agents (Claude Code, Codex, Gemini) use workspace-specific credentials.
Run once during initial setup — credentials are persisted to `{workspace}/.agents/`.

```bash
# Linux/macOS
./run.sh login claude --workspace=/path/to/workspace
./run.sh login codex  --workspace=/path/to/workspace
./run.sh login gemini --workspace=/path/to/workspace

# Windows
.\run.ps1 login claude --workspace=D:\workspace
```

### Multi-Instance Scaling

Multiple instances can run simultaneously against the same workspace.
When `--instance` is specified, shared infrastructure (Redis, docker-proxy) is started first automatically.

```bash
./run.sh prod --workspace=/path/to/workspace --instance=worker1 --web-port=4200
./run.sh prod --workspace=/path/to/workspace --instance=worker2 --web-port=4201
```

---

## Docker Compose Direct Usage (Advanced)

To use `docker compose` directly without the run scripts:

```bash
# Basic run
HOST_WORKSPACE=/path/to/workspace docker compose -f docker/docker-compose.yml up -d

# GPU profile (Ollama LLM classifier)
docker compose -f docker/docker-compose.yml --profile gpu up -d

# Redis message bus (multi-instance)
docker compose -f docker/docker-compose.yml --profile redis up -d
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_WORKSPACE` | — | Workspace host path **(required)** |
| `WEB_PORT` | `4200` | Dashboard port |
| `BUILD_TARGET` | `production` | Dockerfile build stage |
| `NODE_ENV` | `production` | Node.js environment |
| `BUS_BACKEND` | `memory` | Message bus (`memory` or `redis`) |
| `BUS_REDIS_URL` | `redis://redis:6379` | Redis connection URL |

### Container Architecture

```
docker/docker-compose.yml
  ├─ docker-proxy     ← Secure Docker socket proxy (POST-only)
  ├─ ollama           ← Orchestrator LLM [profile: gpu]
  ├─ redis            ← Message bus [profile: redis] (256MB, AOF)
  └─ orchestrator     ← SoulFlow runtime
       ├─ /data       ← Workspace volume (config, DBs, skills)
       ├─ /agents     ← CLI agent auth tokens (Claude, Codex, Gemini)
       └─ :4200       ← Dashboard + API
```

### Dockerfile Stages

| Stage | Purpose |
|-------|---------|
| `deps` | Node.js dependencies + native builds (better-sqlite3) |
| `build` | TypeScript compile + Vite frontend build |
| `production` | Minimal runtime image (node:22-slim + python3 + tini) |
| `full` | Production + Claude Code, Codex CLI, Gemini CLI |
| `dev` | devDependencies included + watch mode |

---

## Local Run (Not Recommended)

> Container deployment provides CLI agent isolation, consistent environments, and simpler setup.
> Use local only when containers are unavailable.

```bash
cd next
npm install

# Development (hot reload)
npm run dev

# Production build
npm run build
node dist/main.js
```

---

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

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `--workspace parameter is required` | Add `--workspace=PATH` to run script |
| `another instance is active` | Stop other process using the same token |
| No response | Verify token/chat ID, run `/doctor` |
| Dashboard unreachable | Check `--web-port` or stop conflicting process |
| SDK backend fails | Check log for `backend_fallback` (auto-fallback to CLI) |
| Container won't start | Verify Docker/Podman daemon is running, check `run.sh logs` |
| Agent login fails | Re-run `./run.sh login claude --workspace=...` |

## Next Steps

→ [Dashboard Guide](../guide/dashboard.md)
→ [Understanding Channels](../core-concepts/channels.md)
→ [Choosing an Agent Backend](../core-concepts/agents.md)
