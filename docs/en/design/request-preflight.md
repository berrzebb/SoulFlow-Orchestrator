# Request Preflight Design

## Purpose

`request preflight` is the layer that performs input normalization and execution preparation before orchestration begins.
Its job is to avoid sending raw inbound requests directly into execution, and instead produce a prepared request shape that later stages can reason about consistently.

The design has four core intentions:

- do not let sensitive inbound text flow directly into execution
- detect resumable work before expensive preparation
- compute skill, runtime policy, and tool context only once
- let the dispatcher focus on routing instead of input assembly

## Position

It sits at the start of `OrchestrationService.execute()`.

```text
Inbound Request
  -> Request Preflight
  -> Execute Dispatcher
  -> once / agent / task / phase runner
```

`request preflight` comes before the dispatcher and far before any runner.
It does not choose an execution strategy. It prepares the shared inputs needed for that choice.

## Responsibilities

### 1. Seal inbound input

Message text and media inputs are sealed first.

- text goes through `seal_inbound_sensitive_text()`
- if sealing fails, the system still avoids passing raw text by falling back to `redact_sensitive_text()`
- local references are preserved during media sealing because they are path semantics, not user prose

This guarantees that later phases all operate on the same sealed view of the request.

### 2. Detect resumable execution early

When `resumed_task_id` is provided, preflight checks whether the runtime still has a matching task in `running` state.

- if so, it returns `kind: "resume"`
- it does not build heavy context for that path
- the resume decision happens after sealing and before the rest of preflight

This keeps retry and long-running task continuation fast.

### 3. Inspect secret references

Preflight inspects sealed text and media for secret references and returns a structured `secret_guard`.

It captures:

- missing keys
- invalid ciphertexts

This layer does not decrypt secrets or make the execution decision itself.
It only produces the evidence needed for later stages to decide whether execution can continue.

### 4. Assemble skill, policy, and execution context

When the request is not a resume path, preflight computes the shared execution context.

- combines always-on skills with recommended skills
- resolves `runtime_policy`
- gathers tool definitions and categories
- creates request scope, request task id, and event metadata
- builds context block and tool execution context
- collects skill-level provider preferences
- gathers active tasks in the current chat

The dispatcher consumes this prepared state instead of rebuilding it.

### 5. Prepare the tool index

Preflight may rebuild the tool index using current tool definitions and category metadata.

This is not tool selection.
It is synchronization of the searchable tool space with the current runtime state.

## Inputs and Outputs

### Inputs

- inbound `OrchestrationRequest`
- secret vault
- agent runtime
- runtime policy resolver
- workspace path
- optional tool index

### Outputs

Preflight returns one of two shapes.

- `ResumedPreflight`
  - an already-running task can be resumed
- `ReadyPreflight`
  - the dispatcher has all context needed to choose and execute a route

This `kind`-based split prevents the resume path from being mixed with the normal execution path.

## Boundaries

`request preflight` must not:

- choose between once / agent / task / phase
- perform gateway routing
- generate user-facing replies
- perform tool selection
- assemble role/protocol prompt profiles

It is a preparation layer, not an execution layer.

## Meaning in the Current Architecture

The current project does not treat `execute()` as one large monolithic function.
Instead it uses `preflight -> dispatcher -> runner`.

Within that shape, preflight fixes the following invariants:

- input normalization ends here
- later layers only see sealed input
- resume vs ready is decided here
- shared runtime context is assembled here once

That separation is what allows the dispatcher to focus on route selection instead of request assembly.

## Non-goals

- audit state or completion tracking
- workflow progress bookkeeping
- session reuse policy decisions themselves
- role/protocol prompt compilation

This document describes the currently adopted design concept.
Execution planning and remaining work live under `docs/*/design/improved/*`.
