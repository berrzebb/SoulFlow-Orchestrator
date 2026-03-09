# Design: Chat NDJSON Streaming

> **Status**: Implemented

## Overview

Improves Web Chat UI streaming from a global SSE event to a **per-session NDJSON HTTP stream**.
Uses Fetch ReadableStream with tab-visibility buffering, independent per-session connections, and delta-only transmission.

## Comparison

| | Before (Global SSE) | **After (NDJSON Local)** |
|---|---|---|
| Channel | `/api/sse` global events | `/messages/stream` per-session |
| Content unit | Full accumulated (`content`) | Delta only (`content.slice(offset)`) |
| Tab switch | Renders continuously (wasteful) | Buffers, flushes on tab return |
| Connection scope | Shared across all clients | Request-scoped to session owner |
| Cancellation | Not possible | `AbortController` |
| Fallback | — | SSE `web_stream` (other sessions or unsupported) |

## Server Architecture

```
POST /api/chat/sessions/:id/messages/stream
          │
          ├─ add_stream_listener(session_id, fn)  ← register BEFORE publish (no delta loss)
          │
          ├─ bus.publish_inbound(...)
          │
          └─ SseManager.broadcast_web_stream(chat_id, content, done)
                  │
                  └─ delta = content.slice(offset)
                     fn(delta, done)  →  res.write(JSON)
```

### NDJSON Event Types

```jsonc
{ "type": "start" }                         // message received acknowledgment
{ "type": "delta", "content": "Hello" }     // streaming delta
{ "type": "done" }                           // stream complete
{ "type": "error", "error": "timeout" }     // error (2min timeout or publish failure)
```

### Key Files

| File | Role |
|---|---|
| `src/dashboard/sse-manager.ts` | `stream_listeners` Map, delta tracking, `add_stream_listener()` |
| `src/dashboard/broadcaster.ts` | Optional `add_stream_listener?` in `SseBroadcasterLike` |
| `src/dashboard/route-context.ts` | `add_stream_listener` field in `RouteContext` |
| `src/dashboard/service.ts` | Binds `this._sse.add_stream_listener` in `_build_route_context` |
| `src/dashboard/routes/chat.ts` | `POST .../messages/stream` endpoint |

## Frontend Architecture

### useNdjsonStream Hook

```typescript
const { stream, start, cancel } = useNdjsonStream();
// stream: { chat_id, content, done } | null
// start(chat_id, body): Promise<void>  — resolves when streaming completes
// cancel(): void                        — AbortController cancellation
```

**Tab visibility buffering:**
- `document.visibilityState === "hidden"` → accumulate deltas in `buffer_ref`
- `visibilitychange` event detects tab return → flush buffer at once

### Stream Priority in chat.tsx

```typescript
const active_stream =
  ndjson_stream?.chat_id === activeId ? ndjson_stream    // 1st: NDJSON local
  : web_stream?.chat_id === activeId ? web_stream        // 2nd: SSE global (fallback)
  : null;
```

### Lifecycle

```
send() called
  → start_stream(chat_id, body)  // fire-and-forget, setSending(false) immediately
  → NDJSON delta received → renders as virtual_msg in real-time
  → type:"done" received → stream.done = true
  → qc.invalidateQueries(["chat-session", id])  // refetch
  → assistant message arrives in activeSession.messages
  → cancel_stream()  // prevents duplicate, removes virtual message
```

## Design Decisions

- **Listener registration order**: `add_stream_listener` is registered *before* `bus.publish_inbound`. This prevents missing early deltas when the agent responds quickly.
- **SSE fallback preserved**: The global `web_stream` store is kept. Mirror sessions and other channels continue to work as before.
- **Timeout**: 2 minutes (120s). If no agent response, sends `type:"error"` and closes.
- **Content-Type**: `application/x-ndjson; charset=utf-8` — explicitly signals line-delimited JSON stream.
