# What is SoulFlow?

SoulFlow is an async orchestration runtime that processes Slack · Telegram · Discord messages through **headless agents**.

It receives messages from chat channels, routes them to specialized agents, and streams responses back. The server runs continuously — users delegate tasks through chat alone.

## Core Components

| Component | Role |
|-----------|------|
| **Channels** | Receive and respond via Slack · Telegram · Discord · Web |
| **Orchestrator** | Classify message → run agent → return result |
| **Agent Backends** | Claude SDK · Claude CLI · Codex AppServer · Codex CLI |
| **Role Skills** | butler → pm/pl → implementer/reviewer/debugger/validator |
| **Security Vault** | AES-256-GCM sensitive data management |
| **OAuth Integration** | GitHub · Google · Custom OAuth 2.0 external service auth |
| **Dashboard** | Web-based real-time monitoring and management |

## When to Use SoulFlow

**Good fit:**
- Running Claude/Codex 24/7 from a chat channel
- Delegating code analysis, file processing, or scheduled tasks through chat
- Operating one agent across multiple channels (Slack + Telegram simultaneously)
- Integrating external services (GitHub, Google) into agent workflows

**Not a good fit:**
- You only need simple chatbot replies (direct Claude API is simpler)
- GUI-heavy interaction is required

## Processing Flow

```
Channel message received
  → Sensitive data Sealing
  → Slash command routing (if applicable)
  → Orchestrator routing
  → Agent backend execution (claude_sdk / claude_cli / ...)
  → Role skill applied (butler → expert delegation)
  → Streaming response
```

## Next Steps

→ [Installation & Setup](./installation.md)
→ [Dashboard Guide](../guide/dashboard.md)
