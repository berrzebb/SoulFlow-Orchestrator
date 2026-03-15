# Execution Guardrails Design

## Purpose

Execution guardrails define a shared **bounded execution policy** across
`once / agent / task / workflow` paths.

The goal is to prevent two common failure modes:

- the agent wastes tool calls re-exploring something it already found
- the agent keeps calling tools indefinitely because no hard budget exists

This is not about throttling providers or controlling UI verbosity.
It is about making the execution layer aware of what it already knows
and when it has used enough resources.

## Two layers

The guardrail design separates soft and hard constraints deliberately.

**Soft gate — session reuse and freshness:**

Before spending a tool call, the runtime checks:

- is there a recent session turn that already answered this?
- is the current query the same as or a near-duplicate of a recent search?
- is the existing evidence still fresh enough to answer from?

If yes, the runtime can reuse the evidence and skip the tool call.
If the prior attempt failed or was incomplete, reuse is blocked — a failed session is not treated as reliable evidence.
If the user explicitly requests a retry (`again`, `retry`, `try again`), the reuse gate is bypassed and a fresh execution is started.

**Hard gate — tool call budget:**

`orchestration.maxToolCallsPerRun` sets an explicit per-run tool-call ceiling.
Once reached, execution stops with a `max_tool_calls_exceeded` stop reason.
This applies equally across all execution paths — once, agent, task, workflow fan-out.
Setting the value to `0` disables the limit.

## Freshness windows

Session evidence expires.
If the prior turn is older than `orchestration.freshnessWindowMs`, the cache is treated as stale and a fresh search is triggered even if the topic matches.

Time-sensitive queries benefit from this: a short freshness window forces rechecks, while a long window allows stable-domain answers to be reused confidently.

## Failure-aware reuse

Prior session attempts are classified by outcome:

- successful / complete → eligible for reuse
- failed / cancelled / incomplete → excluded from reuse

This distinction prevents the runtime from summarizing a broken prior run as if it had produced a usable answer.

## Stop reasons

When a guardrail terminates execution, the stop reason is recorded explicitly:

| Stop reason | Trigger |
|-------------|---------|
| `reuse_summary` | answered from existing session evidence |
| `same_topic` | duplicate query within freshness window |
| `stale_retry` | evidence exists but is too old, prompting a fresh search |
| `retry_failed_attempt` | prior attempt failed; explicit retry path taken |
| `new_search` | no prior evidence; normal fresh execution |
| `max_tool_calls_exceeded` | hard budget reached |

These reasons appear in execution logs and can be surfaced in the dashboard for operator visibility.

## Relationship to turn limits

`agentLoopMaxTurns` and `taskLoopMaxTurns` limit reasoning turns.
`maxToolCallsPerRun` limits tool executions regardless of turn count.

These are separate constraints and neither substitutes the other.
A long chain of reasoning turns with no tool calls does not consume the tool budget.
A burst of tool calls in a single turn counts toward the budget.

## Related docs

→ [Loop Continuity + HITL](./loop-continuity-hitl.md)
→ [Phase Loop](./phase-loop.md)
→ [Execute Dispatcher](./execute-dispatcher.md)
