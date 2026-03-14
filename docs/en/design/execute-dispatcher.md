# Execute Dispatcher Design

## Purpose

`execute dispatcher` is the orchestration routing layer that turns a prepared request into an actual execution path.
Its responsibility is to decide how a request should be handled and to pass that decision consistently into runners and gateway bindings.

The current project does not send every request through the same agent loop.
Instead, the dispatcher chooses among:

- short-circuit replies
- direct tool execution
- once execution
- agent loop
- task loop
- phase workflow

## Position

```text
Inbound Request
  -> Request Preflight
  -> Execute Dispatcher
  -> once / agent / task / phase runner
```

The dispatcher sits after preflight and before any runner.
Input assembly ends in preflight. Route selection, escalation, and fallback begin in the dispatcher.

## Core Responsibilities

### 1. Accept the gateway decision

The dispatcher consumes the result of `resolve_gateway()` and turns it into an executable route.

That decision is based on:

- the current user request
- recent session history
- active tasks in the chat
- available skills and tool categories
- executor capability

The dispatcher does not replace this judgment. It operationalizes it.

### 2. Handle short-circuits

Not every request should reach a runner.
The dispatcher exits early for:

- `identity`
- `builtin`
- `inquiry`

When a tool call is both deterministic and safe, it may also use direct tool execution instead of opening an LLM loop.

The goal is to avoid expensive execution paths whenever a cheaper path is sufficient.

### 3. Apply session reuse and freshness gates

For non-phase execution, the dispatcher may decide that a recent answer or recent search evidence should be reused instead of triggering fresh tool work.

It can evaluate:

- whether the same question was already handled
- whether the new question is the same topic
- whether the evidence is still fresh enough

This is the first cost-control gate in the execution path.

### 4. Finalize mode and executor

After short-circuits, the dispatcher fixes the actual execution mode and executor.

- `phase`
- `once`
- `agent`
- `task`

It also folds in user provider preference, configured executor, and capability-based fallback.

### 5. Open tool-selection and system-prompt entry

For non-phase paths, the dispatcher opens the tool-selection and system-prompt stage.

It does not define prompt policy itself.
Prompt content comes from runtime, role, and protocol layers. The dispatcher only decides which execution path receives that prepared prompt.

### 6. Manage confirmation, escalation, and fallback

The dispatcher is not only a router. It is also a bounded control layer.

- it can defer risky work through a confirmation guard
- it can escalate a once result into task execution
- it can escalate an agent outcome into task execution
- it can retry through an executor fallback chain

This means the dispatcher owns allowed escalation and fallback inside the execution boundary.

### 7. Finalize results consistently

All execution results pass through the same finalization path.

- append workflow events
- update process tracking
- preserve usage and tool-call counts
- append follow-up checklists for validation roles

This keeps closing behavior consistent across runners.

## Boundaries

The dispatcher must not:

- reseal inputs or re-inspect secrets
- rebuild skill recommendations from scratch
- interpret role or protocol documents directly
- generate persona phrasing directly
- own tool execution bodies
- generate or persist workflow definitions

It is the routing layer between prepared requests and execution engines, not a replacement for preflight or runners.

## Routing Order in the Current Architecture

The current project follows roughly this sequence:

```text
gateway decision
  -> identity / builtin / inquiry short-circuit
  -> optional direct tool
  -> session reuse gate
  -> mode / executor resolution
  -> phase branch or tool selection
  -> confirmation guard
  -> once / agent / task runner
  -> escalation / fallback
  -> finalize
```

This order is intentional:

- do the cheapest decisions first
- open the most expensive loops last
- exhaust deterministic handling and reuse before fresh execution
- close results under one consistent policy

## Relationship to Gateway and Direct Execution

The dispatcher includes gateway and direct execution, but it is not the same layer as either of them.

- gateway decides what kind of request this is
- direct executor runs safe deterministic tools without an LLM
- dispatcher places both into the full execution route

Even if gateway or direct execution expands, the dispatcher should remain focused on route selection plus bounded escalation/finalization.

## Relationship to Session Reuse Policy

The dispatcher is the first application point for session reuse, but not the source of truth for reuse policy.

Its job is only to:

- consume reuse evidence
- short-circuit when reuse is valid
- otherwise continue into normal execution

The policy details themselves belong to the guardrail layer.

## Non-goals

- audit state or completion tracking
- long-term session memory strategy
- tool ranking algorithm design
- role / protocol / persona source-of-truth ownership

This document explains the currently adopted dispatcher boundary in the project.
Detailed work decomposition belongs under `docs/*/design/improved/*`.
