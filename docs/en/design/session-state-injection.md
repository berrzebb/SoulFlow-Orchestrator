# Session State Injection Design

## Purpose

`session state injection` defines how session-scoped collaborators are assembled outside the orchestration service and injected into it explicitly.
Its purpose is to reduce hidden state inside the service and make **session observers, pending HITL state, and compaction-related collaborators explicit parts of assembly**.

The core intent is:

- keep `OrchestrationService` closer to a coordinator than a hidden state owner
- let bootstrap own the lifecycle of session-scoped collaborators
- make tests able to inject mock collaborators directly
- ensure hooks, runners, and dashboard-facing accessors observe the same session state

## Session-Scoped Collaborators

The main collaborators in this design are:

- `session_cd`
  - an observer that tracks execution events and exposes CD score
- `hitl_pending_store`
  - a pending-state store for human-in-the-loop responses
- compaction-related collaborators
  - injected config or helpers used for memory flush and context preservation

The key design rule is that these are not inline service-owned state variables.
They are externally assembled collaborators.

## Assembly Location

Session state is assembled in bootstrap:

```text
bootstrap
  -> create session collaborators
  -> inject into OrchestrationService
  -> pass through to hooks / runners / dashboard accessors
```

So the orchestration service is not the source of session state.
It is the consumer and coordinator of already-created state.

## Why Injection Matters

### 1. Testability

If the service creates its own session observer or pending store:

- mock replacement becomes harder
- lifecycle control becomes implicit
- narrow state-transition tests become more complex

Injection makes those collaborators easy to replace in tests.

### 2. Consistency Across Paths

Session state is used in multiple paths:

- hooks
- once / agent / task runners
- workflow continuation
- dashboard stats
- HITL bridge paths

These paths must not observe different instances of the same session-scoped state.
Bootstrap-level ownership solves that.

### 3. Clearer Service Responsibility

`OrchestrationService` should focus on request coordination and execution dispatch.
If it also creates and owns session observers and pending state, it becomes both execution coordinator and state factory.

This design intentionally avoids that responsibility mix.

## Meaning of `session_cd`

`session_cd` is a session-level event observer.

From the design perspective, the important point is not the scoring formula itself.
The important point is that the observer is injected rather than constructed inline.

This document therefore describes placement and ownership, not the scoring algorithm.

## Meaning of `hitl_pending_store`

`hitl_pending_store` preserves pending interaction state until a user reply arrives.

It needs to be injected because:

- dashboard and channel bridges must observe the same pending state
- workflow continuation must resume against the same pending store
- a hidden internal map would make the state invisible to adjacent layers

So pending HITL state is a shared collaborator between orchestration and surrounding runtime surfaces.

## Relation to Compaction

Session-state injection also connects to the compaction path.

Why:

- compaction flush decisions depend on current execution state
- those decisions are not just pure prompt logic; they interact with runtime collaborators
- compaction helpers therefore fit better as injected config or injected collaborators

At the design level, the main rule is that the service should not create private execution-state machinery on its own.

## Public Contracts

Session state should not remain trapped entirely inside the orchestration layer.
Some state must be observable or controllable from adjacent layers.

Examples include:

- reading current CD score
- resetting CD score
- resolving pending HITL input

These contracts do not exist to expose internal structures directly.
They exist so the surrounding system can interact with the same session state consistently.

## Boundaries

This design does not:

- define the full session-memory retrieval policy
- describe the detailed CD scoring algorithm
- define the full workflow state machine
- define the final dashboard presentation of session metrics

`session state injection` is about collaborator ownership and dependency boundaries.

## Meaning in This Project

This project runs orchestration alongside channels, dashboard, and workflow features.
In that environment, hiding session state inside one service is less useful than assembling it explicitly and sharing it across paths.

This document fixes that top-level design:

- session state is modeled as collaborators
- bootstrap creates those collaborators
- orchestration consumes and coordinates them
- hooks, runners, and dashboard paths share the same state

## Non-Goals

- recording phase or completion status
- tracking test counts
- documenting the detailed math behind scoring
- designing the entire HITL UX here

This document describes the adopted session-state injection design.
Detailed breakdown and follow-up work belong in `docs/*/design/improved/*`.
