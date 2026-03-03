# Channels

Channels are SoulFlow's input/output layer to the outside world. They receive messages and send back agent responses.

## Supported Channels

| Channel | Reception | Notes |
|---------|-----------|-------|
| Slack | Socket Mode (WebSocket) | Thread replies, file upload support |
| Telegram | Long Polling | Group/DM, file attachment |
| Discord | WebSocket Gateway | Server/DM, embed messages |
| Web Chat | SSE (Server-Sent Events) | Browser chat inside dashboard |

## Response Modes

### Streaming

Partial results are sent periodically while the agent generates a response. Users can see progress during long tasks.

Enable/disable and adjust the flush interval from the dashboard → **Settings** → `channel.streaming` section.

### Message Grouping

Multiple responses within a short window are batched into one message, reducing chat spam.

Configure from the dashboard → **Settings** → `channel.grouping` section.

## Message Processing Pipeline

```
Incoming message
  1. Sensitive data auto-Sealing  ← tokens/passwords replaced with Vault refs
  2. Slash command detection      ← /stop, /status, /secret, etc.
  3. Orchestrator handoff         ← agent execution
  4. Response dispatch            ← streaming or single send
```

## Concurrency

Messages from multiple channels are processed independently and in parallel.

Adjust concurrency limit, polling interval, and max messages per poll from the dashboard → **Settings** → `channel` section.

## Dispatch Failures and Retry

Failed deliveries are retried with exponential backoff. After max retries, messages are stored in the Dead Letter Queue (DLQ).

Configure retry count, backoff interval, and DLQ settings from the dashboard → **Settings** → `channel.dispatch` section.

Check `runtime/dlq/dlq.db` to review and manually reprocess failed messages.

## Multiple Instances

Add multiple instances of the same provider from the **Channels** page in the dashboard. Example: two Slack channels + one Telegram group running simultaneously.

Each instance is identified by a unique `instance_id`, and message routing is based on `instance_id`.

## Related Docs

→ [Agent Backends](./agents.md)
→ [Provider Configuration Guide](../guide/providers.md)
