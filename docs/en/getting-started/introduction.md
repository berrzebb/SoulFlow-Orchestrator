# What is SoulFlow?

SoulFlow is an async orchestration runtime that processes Slack · Telegram · Discord messages through **headless agents**.

It receives messages from chat channels, routes them to specialized agents, and streams responses back. The server runs continuously — users delegate tasks through chat alone.

## Core Components

| Component | Role |
|-----------|------|
| **Channels** | Receive and respond via Slack · Telegram · Discord · Web |
| **Orchestrator** | Classify message → run agent → return result |
| **Agent Backends** | 8 backends: Claude/Codex × CLI/SDK + Gemini CLI + OpenAI-compatible + OpenRouter + Container CLI |
| **Role Skills** | butler → pm/pl → implementer/reviewer/debugger/validator |
| **Security Vault** | AES-256-GCM sensitive data management |
| **OAuth Integration** | GitHub · Google · Custom OAuth 2.0 external service auth |
| **Dashboard** | Web-based real-time monitoring and management |

## When to Use SoulFlow

**Good fit:**
- **Multi-agent collaboration** — Parallel specialists (market analyst + tech analyst + strategist) with critic quality gates, where each agent has its own conversation context
- **Autonomous development pipelines** — Spec creation through interactive conversation → planning → sequential implementation with fresh context per task → code review → validation with automatic fix loops
- **Visual workflow automation** — Designing DAGs with 42 node types (HTTP, Code, LLM, IF, Merge, Approval, HITL, Form, etc.) via a graph editor, or letting agents create workflows from natural language ("crawl RSS every morning and summarize")
- **Sandboxed code execution** — Running Python, Go, Rust, Ruby, and 3 other languages in isolated containers with strict resource limits as part of workflow pipelines
- **24/7 chat-driven operations** — Running Claude/Codex/Gemini agents from Slack · Telegram · Discord with 8 backend options, CircuitBreaker auto-fallback, and auth profile rotation
- **Multi-channel agent sharing** — One orchestrator serving Slack + Telegram + Discord simultaneously with per-channel configuration
- **External service integration** — OAuth 2.0 (GitHub, Google, custom) with automatic token injection and 401 auto-refresh
- **Human-in-the-loop workflows** — Approval gates, `[ASK_USER]` markers that pause workflows and ask questions via the originating chat channel, then resume on user response

**Not a good fit:**
- You only need simple chatbot replies (direct Claude API is simpler)
- GUI-heavy interaction is required (SoulFlow is chat-first, dashboard is for monitoring/management)
- You need real-time sub-second latency (orchestration adds routing overhead)

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
