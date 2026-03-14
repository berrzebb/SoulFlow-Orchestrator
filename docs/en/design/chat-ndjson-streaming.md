# Chat NDJSON Streaming Design

## Purpose

`chat ndjson streaming` is the design used to deliver in-progress web chat responses through a session-scoped HTTP stream.
Its purpose is to open a stream only for the active chat session and let the browser control cancellation, visibility buffering, and stream lifecycle directly through the HTTP request itself.

This design exists to solve the following problems:

- reduce coupling to a single global SSE stream for every web chat response
- keep the active chat session on its own local stream
- avoid unnecessary rendering while the browser tab is hidden
- treat message submission and response streaming as the same request boundary

## Current transport model

The current web chat architecture uses two streaming layers together:

- session-scoped NDJSON streaming
- global SSE `web_stream`

Session-scoped NDJSON streaming is the primary web chat path.
The browser sends `POST /api/chat/sessions/:id/messages/stream`, and the server uses that same HTTP response as an `application/x-ndjson` stream for the response lifecycle.

The global SSE `web_stream` still remains in the system.
It serves as the shared broadcast layer for dashboard-wide updates, compatibility with consumers that do not directly use local NDJSON streaming, and other web-facing real-time surfaces.

So the current design is not “NDJSON replaces SSE entirely.”
It is “web chat uses session-scoped NDJSON as its primary response stream, while global SSE remains as the shared broadcast layer.”

## Server boundaries

The server-side source of truth for this design sits in:

- `src/dashboard/routes/chat.ts`
- `src/dashboard/sse-manager.ts`
- `src/dashboard/broadcaster.ts`
- `src/dashboard/route-context.ts`
- `src/dashboard/service.ts`

In this design, the chat route has two responsibilities:

- validate session ownership and request payload
- register a stream listener before inbound publish begins

The ordering is important.
Listener registration happens before publish so that a very fast first response chunk is not lost.

`SseManager` is not only a global SSE sender in the current architecture.
It also acts as the registration point for session-scoped rich stream listeners and forwards incremental stream events instead of only accumulated content snapshots.

## Event model

The NDJSON stream is not just a pipe for one final response string.
In the current design, the chat route writes a start event first, then forwards rich stream events produced by the broadcaster/channel path, and finally closes with either a done event or an error event.

The key properties are:

- the stream is scoped to one chat session
- events are transmitted as line-delimited JSON
- completion and failure are part of the same stream contract
- the transport layer does not replace message persistence

The stream therefore exists for in-progress delivery.
The persistent source of truth for final messages remains the chat session store.

## Frontend model

The frontend source of truth for this design sits in:

- `web/src/hooks/use-ndjson-stream.ts`
- `web/src/pages/chat.tsx`
- `web/src/store.ts`
- `web/src/layouts/root.tsx`

Web chat opens the local stream through `useNdjsonStream`.
That hook owns the abort controller, NDJSON parsing, visibility-based buffering, and completion cleanup.

Important current behaviors are:

- when the tab is hidden, incoming chunks are buffered instead of rendered immediately
- when the tab becomes visible again, the buffered content is flushed
- the stream can be cancelled when the user switches sessions or aborts the send
- if the active session has a local NDJSON stream, that stream wins; the global `web_stream` only acts as fallback

This keeps rendering cost and connection scope tied to the active session instead of the entire dashboard.

## Meaning in the current project

This project combines channel broadcasting and dashboard UI in the same system.
A single global real-time stream is not enough to explain every web chat behavior cleanly.

`chat ndjson streaming` is the design used to split the active chat response path into a narrower and more explicit transport contract.

In the current architecture this means:

- chat response streaming is established per session request
- global broadcasting remains as a shared auxiliary layer
- rendering optimization lives in the frontend hook layer
- response transport and persistent session storage are treated as different concerns

## Non-goals

- removing the global broadcast layer entirely
- replacing the persistent chat session store with NDJSON transport
- forcing every non-web channel to use the same transport contract
- freezing internal agent event shapes around web chat only

This document describes the currently adopted streaming design concept.
Migration details, rollout order, and remaining implementation work belong under `docs/*/design/improved/*`.
