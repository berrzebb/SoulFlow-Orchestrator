# Phase Loop Design

## Purpose

`phase loop` is the workflow execution design used to run multi-agent work as ordered phases with explicit per-phase modes, state, and critic/gate behavior.
Its purpose is to represent work that is more structured than a single agent loop and richer than a simple linear task chain.

In the current project, phase loop is used to solve the following problems:

- represent parallel research and sequential implementation in the same workflow
- assign different agent groups and roles per phase
- insert critic or gate behavior at phase boundaries
- persist wait/resume/escalation as workflow state instead of hidden runtime side effects

## Current execution model

The current execution model is “phases run in order, each phase decides its own internal mode.”

The supported phase modes are:

- `parallel`
- `interactive`
- `sequential_loop`

Each mode changes how work happens inside one phase.
The overall workflow still moves through ordered phases and shared workflow state.

In practice:

- `parallel`
  - multiple agents run inside one phase concurrently
- `interactive`
  - one phase progresses through user-facing back-and-forth
- `sequential_loop`
  - one phase iterates through fresh-context executions until completion

## Core state

The source of truth for phase loop is workflow state.
Individual agent sessions, dashboard rendering, and channel delivery all consume or update that state, but they are not the primary authority.

The current state model includes:

- workflow status
- current phase
- per-phase status
- phase memory
- loop iteration / loop results
- critic review / approval
- wait states such as `waiting_user_input`

This lets workflows be observed in the dashboard, resumed from channels, and rendered consistently across multiple surfaces.

## Critic and gating

Phase loop treats critic behavior as a phase-boundary control mechanism, not just as optional commentary.
A critic can review phase output and affect whether execution continues, retries, escalates, or jumps back through goto behavior.

The important properties are:

- critic belongs to the phase contract
- critic review is stored alongside phase state
- rejection is allowed to change control flow, not only produce text

So phase loop is both a multi-agent execution model and a workflow control-flow engine.

## User input and resume

Phase loop treats user input waiting as a normal state transition rather than an exceptional condition.
When an agent or critic asks for user input, the workflow can move into `waiting_user_input` and later resume from the same workflow state.

The design assumption is:

- resume is keyed to workflow state
- user input belongs to a specific phase/iteration context
- a workflow may stop mid-flight and later continue from persisted state

## Meaning in the current project

This project is not only an agent runner.
It also includes workflow authoring, dashboard monitoring, and channel delivery.

Phase loop is the execution model that ties those surfaces together.
In the current architecture this means:

- workflows are declared as YAML or structured definitions
- declared phases are executed by a common runner
- dashboard views render phase progress from the same state model
- channels participate in wait/resume through workflow state

Phase loop is therefore not an implementation detail.
It is the current project’s standard workflow execution model.

## Relationship to other loops

- `agent loop`
  - single-agent centered execution
- `task loop`
  - step-by-step sequential execution
- `phase loop`
  - multi-agent phase-based execution with gates

These are not competing abstractions.
They divide responsibility by workload shape and complexity.

## Non-goals

- forcing every request into phase loop
- using phase loop for trivial execution with no need for phases or gates
- replacing workflow state with UI rendering state
- collapsing interactive clarification and approval into one undifferentiated mechanism

This document describes the currently adopted phase loop design concept.
Migration details, rollout, and work breakdown belong under `docs/*/design/improved/*`.
