# Parallel Agent Reconciliation Design

## Purpose

When a Phase Loop fans out to multiple parallel branches, each branch
produces an independent result. Reconciliation is the step that converges
those results into one coherent output before the workflow moves on.

The design goal is **conflict detection → synthesis → bounded critique** —
not open-ended debate.

## When reconciliation applies

Reconciliation is activated when:

- a workflow phase runs two or more parallel agents
- their outputs disagree on a fact, a decision, or a recommendation
- the workflow needs one result to proceed

Without a reconcile step, the workflow would either arbitrarily pick one branch
or surface a confusing multi-answer to the user.

## Reconcile node

A `ReconcileNode` sits at the fan-in point of a parallel workflow phase.

It receives the `ParallelResultEnvelope` — the collected outputs from all
parallel branches — and produces a single merged result.

The reconcile node does not invent new content.
It selects, merges, or flags for critique based on what the branches already returned.

## Conflict detection

Before any model is involved, the reconcile node checks whether the conflict
can be resolved deterministically:

- if only one branch succeeded, the successful result is selected
- if branches agree, the consensus result is passed through
- if branches disagree on a structured field with a known rule (e.g. higher confidence wins), the rule is applied
- only unresolvable disagreements are escalated to the critic

Sending deterministically closable conflicts to a model arbiter is a design mistake
this system avoids explicitly.

## Merge strategies

| Strategy | When used |
|----------|-----------|
| `select` | one branch result is chosen; others are discarded |
| `merge` | compatible outputs are combined into one |
| `escalate` | disagreement cannot be resolved; human or critic review required |

## Critic gate

When escalation happens, a `CriticGate` receives the conflict summary and
can request a revision from one or more branches.

The critic operates under a `RetryBudget`.
By default: one retry allowed, maximum two.
After the budget is exhausted, the workflow records the unresolved conflict
and continues with the best available result or escalates to the user.

The critic does not have unlimited authority to rerun branches.
This bound is what distinguishes reconciliation from a debate loop.

## Workflow schema

Phase Loop workflows include `fanout` and `reconcile` steps as first-class
schema elements. A reconcile step references its upstream branches and
specifies the merge strategy and retry budget.

This means reconciliation behavior is visible in the workflow graph editor,
not hidden inside generic node logic.

## Visibility

Reconcile results, conflict sets, and critic decisions are stored with the
workflow execution record. The workflow detail view surfaces:

- which branches agreed or disagreed
- which strategy was applied
- whether a critic retry was triggered and what it produced

## Related docs

→ [Phase Loop](./phase-loop.md)
→ [Interaction Nodes](./interaction-nodes.md)
→ [Execution Guardrails](./execution-guardrails.md)
