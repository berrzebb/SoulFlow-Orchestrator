# Interactive Loop Design

## Purpose

`interactive loop` is the design used when a phase must collect requirements from the user or resolve blockers through back-and-forth interaction during execution.
Its purpose is to separate “one-shot agent execution” from “execution that intentionally waits for user replies and then continues.”

In the current project, interactive loop exists for cases such as:

- phases that build a specification together with the user
- phases that need clarification before work can continue
- phases that must switch into HITL rather than pretending the system can fully close the task alone

## Position in the current architecture

Interactive loop is not a standalone execution engine.
It is one phase mode inside the broader `phase loop` model.

The current phase model supports three modes:

- `parallel`
- `interactive`
- `sequential_loop`

So the design boundary is:

- `phase loop` is the parent execution model
- `interactive loop` is one phase mode inside it
- persistence lives in workflow state and workflow storage
- resume after user input is handled through the HITL/channel layer

## Core contract

The core contract of interactive loop is marker-based:

- `[ASK_USER]`
- `[SPEC_COMPLETE]`

`[ASK_USER]` means the agent needs user input before it can continue meaningfully.
When that marker appears, the workflow can move into `waiting_user_input`, and the next iteration resumes once a user reply arrives.

`[SPEC_COMPLETE]` means the interactive phase has produced the expected artifact and can hand its result to the next phase.

The important design choice is that question and completion are not left as vague natural-language side effects.
They are made explicit in a contract that the phase runner understands.

## State model

Interactive loop depends on explicit workflow state rather than only on one long-lived agent session.
The current state model includes:

- iteration count
- accumulated loop results
- pending user input state
- current workflow / phase status

An iteration may run with fresh context while still carrying prior ask/answer history and accumulated phase output through workflow state.

So the source of truth is workflow state, not a hidden agent-local conversation window.

## HITL boundary

Interactive loop includes HITL, but it is not the same thing as approval flow.

- interactive loop
  - clarification, requirements gathering, interactive completion
- approval flow
  - explicit permission or policy gating

Both can produce `waiting_user_input`, but they represent different meanings.
Interactive loop means “the system needs more information.”
Approval flow means “the system needs permission before it can continue.”

## Meaning in the current project

This project spans Slack, Telegram, dashboard chat, and workflow UI.
User input waiting therefore cannot be treated like a local terminal prompt.

Interactive loop exists to make user-facing clarification part of the workflow contract itself:

- questions are part of phase execution
- wait/resume is represented in workflow state
- ask/answer history is accumulated as loop progress
- the result of an interactive phase becomes input to later phases

So interactive loop is not an optional UI trick.
It is an execution mode that lets a phase-based workflow close work with a human in the loop.

## Non-goals

- turning every task loop into an interactive loop
- merging approval and clarification into one undifferentiated state
- making a single persistent PTY session the source of truth
- becoming an open-ended free-form chat session with no explicit completion contract

This document describes the currently adopted interactive loop design concept.
Rollout details, breakdown, and future improvement work belong under `docs/*/design/improved/*`.
