# Installation & Setup

## Requirements

| Item | Version/Condition |
|------|------------------|
| Node.js | 20 or above |
| Channel Bot Token | At least one of Slack · Telegram · Discord |
| Claude API Key (optional) | Required for `claude_sdk` backend |

## Install

```bash
cd next
npm install
```

## Run

```bash
# Development (hot reload)
cd next && npm run dev

# Production
npm run build
cd workspace && node ../dist/main.js
```

## Initial Setup via Setup Wizard

On first launch, if no provider is configured, the dashboard automatically redirects to the **Setup Wizard** (`/setup`).

```
http://127.0.0.1:4200
```

The wizard guides you through:
1. **AI Provider** — Enter Claude/Codex API key
2. **Channels** — Enter Slack/Telegram/Discord Bot Token
3. **Agent Settings** — Select default role and backend

All configuration is handled through the Wizard.

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
| Dashboard unreachable | Change port in Settings or stop the conflicting process |
| SDK backend fails | Check log for `backend_fallback` (auto-fallback to CLI) |

## Next Steps

→ [Dashboard Guide](../guide/dashboard.md)
→ [Understanding Channels](../core-concepts/channels.md)
→ [Choosing an Agent Backend](../core-concepts/agents.md)
