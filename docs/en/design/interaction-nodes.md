# Design: Interaction Nodes & Runner-Level Execution

> **Status**: Implementation complete · 10 new node types · Runner special-node dispatch

## Overview

Extends the workflow engine with **10 new orchestration nodes** requiring runner-level context (channel communication, retry loops, batch execution, tool invocation) that cannot be handled by the generic `execute_orche_node` dispatcher alone.

## Problem

The existing `execute_orche_node` path provides `OrcheNodeExecutorContext` (memory + abort_signal + workspace), which is insufficient for nodes that need:
- Channel send/receive (HITL, Approval, Form, Notify, Escalation, SendFile)
- Retry orchestration with backoff (Retry)
- Parallel sub-execution (Batch)
- Tool registry access (Tool Invoke)
- Multi-source quorum evaluation (Gate)

## Architecture

### Execution Flow

```
phase-loop-runner: orche node block
  │
  ├── execute_special_node(node, state, options, deps)
  │     ├── hitl       → ask_channel(prompt, timeout) → ChannelResponse
  │     ├── approval   → ask_channel(structured:approval) → votes, approved
  │     ├── form       → ask_channel(structured:form) → fields
  │     ├── notify     → send_message(content) → ok, message_id
  │     ├── send_file  → send_message([file:path]) → ok
  │     ├── escalation → evaluate_condition → send_message if triggered
  │     ├── retry      → loop: execute_orche_node(target) + backoff
  │     ├── batch      → parallel: execute_orche_node(body) per item
  │     ├── tool_invoke→ invoke_tool(tool_id, params) → result
  │     └── default    → null (fallback to generic executor)
  │
  └── execute_orche_node(node, ctx) ← generic path for remaining nodes
```

### Callback Protocol

Three optional callbacks on `PhaseLoopRunOptions`:

| Callback | Pattern | Used by |
|----------|---------|---------|
| `send_message` | fire-and-forget | Notify, SendFile, Escalation |
| `ask_channel` | send + wait for response | HITL, Approval, Form |
| `invoke_tool` | tool_id + params → string | Tool Invoke |

All callbacks are optional — nodes gracefully degrade when unavailable (warn log + default output).

### Channel Communication Types

```typescript
interface ChannelSendRequest {
  target: "origin" | "specified";
  channel?: string;
  chat_id?: string;
  content: string;
  structured?: { type: "approval" | "form"; payload: Record<string, unknown> };
  parse_mode?: string;
}

interface ChannelResponse {
  response: string;
  responded_by?: { user_id?: string; username?: string; channel?: string };
  responded_at: string;
  timed_out: boolean;
  approved?: boolean;       // Approval
  comment?: string;         // Approval
  votes?: Array<...>;       // Approval (multi-approver)
  fields?: Record<...>;     // Form
}
```

## Node Catalog

### Interaction Category (channel-bound)

| Node | Shape | Purpose | Runner Logic |
|------|-------|---------|-------------|
| HITL | rect | Free-text Q&A | ask_channel → response |
| Approval | rect | Binary approve/reject + quorum | ask_channel(structured:approval) → approved, votes |
| Form | rect | Schema-based structured input | ask_channel(structured:form) → fields |
| Escalation | rect | Conditional alert to higher channel | evaluate_condition → send_message |

### Flow Category (execution control)

| Node | Shape | Purpose | Runner Logic |
|------|-------|---------|-------------|
| Gate | diamond | K-of-N quorum check | Handler-only (checks memory) |
| Retry | rect | Failed node re-execution | Loop with backoff strategy |
| Batch | rect | Parallel array processing | Concurrent execution with limit |
| Assert | diamond | Data validation checkpoint | Handler-only (evaluates + throws) |

### Advanced Category

| Node | Shape | Purpose | Runner Logic |
|------|-------|---------|-------------|
| Tool Invoke | rect | Dynamic tool execution | invoke_tool callback |
| Cache | rect | TTL-based key-value cache | Handler-only (in-memory store) |

## SSE Events

```typescript
| { type: "node_waiting"; node_id; node_type; reason }   // HITL/Approval/Form waiting
| { type: "node_retry"; node_id; attempt; max_attempts; error }  // Retry backoff
```

## Escalation Condition Evaluation

```
always        → always escalate
on_timeout    → any depends_on node has timed_out=true
on_rejection  → any depends_on node has approved=false
custom        → evaluate custom_expression against memory
```

## Retry Backoff Strategies

| Strategy | Formula |
|----------|---------|
| exponential | `initial * 2^(attempt-1)` |
| linear | `initial * attempt` |
| fixed | `initial` |

All capped at `max_delay_ms`.

## Batch Execution

1. Extract array from `memory[array_field]`
2. Process in chunks of `concurrency` (default 5)
3. Each item: inject as `memory._batch_item` + `_batch_index`
4. Execute `body_node` per item via `execute_orche_node`
5. Collect results, track succeeded/failed counts
6. `on_item_error: "halt"` stops after first failure

## Files Changed

| File | Change |
|------|--------|
| `src/agent/nodes/hitl.ts` | New handler |
| `src/agent/nodes/approval.ts` | New handler |
| `src/agent/nodes/form.ts` | New handler |
| `src/agent/nodes/tool-invoke.ts` | New handler |
| `src/agent/nodes/gate.ts` | New handler |
| `src/agent/nodes/escalation.ts` | New handler |
| `src/agent/nodes/cache.ts` | New handler |
| `src/agent/nodes/retry.ts` | New handler |
| `src/agent/nodes/batch.ts` | New handler |
| `src/agent/nodes/assert.ts` | New handler |
| `src/agent/nodes/index.ts` | Register 10 handlers |
| `src/agent/workflow-node.types.ts` | 10 type definitions + OrcheNodeType/OrcheNodeDefinition unions |
| `src/agent/phase-loop.types.ts` | ChannelSendRequest, ChannelResponse, RunOptions callbacks, SSE events |
| `src/agent/phase-loop-runner.ts` | execute_special_node dispatch + 9 handler functions |
| `web/src/pages/workflows/nodes/*.tsx` | 10 frontend descriptors |
| `web/src/pages/workflows/nodes/index.ts` | Register 10 descriptors + category map |
| `web/src/pages/workflows/node-registry.ts` | interaction category |
| `web/src/i18n/ko.ts`, `en.ts` | ~80 i18n keys |
