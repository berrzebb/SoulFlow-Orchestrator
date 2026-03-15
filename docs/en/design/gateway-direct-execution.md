# Gateway / Direct Execution Design

## Purpose

The execution gateway classifies each incoming request early and routes it
to the cheapest path that can actually satisfy it.

The three paths are:

- **no-token** — slash commands, status queries, guard decisions — no LLM needed
- **model-direct** — single-turn generation, no persistent tool loop required
- **agent** — multi-step reasoning, tool calls, session continuity required

Separating these paths reduces unnecessary agent invocations and makes
execution latency predictable for simple requests.

## Classification

Each inbound message produces a `RequestPlan` that records:

- which execution path was selected
- why (the classification evidence)
- which provider and executor will handle it
- which channel the result must be returned to

Classification happens before any provider is invoked.
The classifier considers the request content, current session state,
available tools, and any active workflow context.

## Execution paths

### Direct tool path

Some requests name a tool or action explicitly.
The gateway can execute those directly without constructing an agent loop.
The result is returned to the original channel immediately.

Examples: `/secret list`, `/cron status`, `wait for approval`, database lookups.

### Model-direct path

Requests that need language model output but not persistent tool use
can be handled with a single inference call.
No session is maintained, no tool loop runs.

Examples: simple explanations, format conversions, one-shot summaries.

### Agent path

Requests that require tool use, multi-turn reasoning, or session memory
go to the full agent loop.
The agent backend is selected based on provider capabilities and circuit breaker state.

## Result envelope

All paths produce a `ResultEnvelope` with a consistent shape:

- the original request reference
- the execution path taken
- the reply content
- the stop reason
- cost and latency metadata

This makes it possible to compare direct and agent results on the same scorecard
and ensures dashboard rendering is uniform regardless of which path ran.

## Channel affinity

Results are always returned through the channel that originated the request.
If a workflow phase produces output for a Slack thread, it returns to that thread —
not to a different channel or a generic fallback.

This is enforced by the `ReplyChannelRef` in the result envelope rather than
relying on ambient routing assumptions.

## Relationship to orchestration

The gateway sits between channel ingress and the agent/workflow runtime.
It does not replace the orchestrator — it decides *whether* to invoke it.

The orchestrator handles multi-turn agent loops, phase workflows, and task tracking.
The gateway handles the question of which path to open before the orchestrator is called.

## Related docs

→ [Execute Dispatcher](./execute-dispatcher.md)
→ [Request Preflight](./request-preflight.md)
→ [Phase Loop](./phase-loop.md)
→ [Execution Guardrails](./execution-guardrails.md)
