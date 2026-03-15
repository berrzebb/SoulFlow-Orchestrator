# Evaluation Pipeline Design

## Purpose

The evaluation pipeline provides a **local-first, provider-neutral** way to
run the same scenario across direct, model-direct, workflow, and agent paths
and compare the results over time.

The goal is not to replace unit or integration tests.
It is to answer questions like:

- does switching from `claude_sdk` to `ollama` change answer quality for this use case?
- did this week's prompt change improve or regress the routing accuracy?
- which execution path is fastest for this category of request?

## Core concepts

### EvalCase

An `EvalCase` is a single test scenario. It contains:

- the input message
- the expected execution path (direct / model / agent)
- the expected output shape or content criteria
- optional tags for grouping into bundles

Cases are versioned and stored as JSON fixtures.
They do not depend on any specific provider being available.

### EvalDataset

A collection of `EvalCase` entries grouped by domain or purpose.
Datasets can be filtered by tag to run focused subsets.

### EvalRunner

The runner replays cases against the live system.
It captures:

- the actual execution path taken
- raw output content
- latency and token cost
- stop reason

The runner does not judge results — it only captures.

### Judge / Scorer

Judges evaluate captured outputs independently from the runner.

Deterministic judges check:

- did the correct execution path run?
- does the output match the expected schema?
- does the output contain required fields?

An optional `LlmJudgePort` can delegate open-ended quality checks to a model,
but deterministic judges always run first.
The LLM judge is never the only judge.

### Scorecard and RunReport

A `Scorecard` summarizes one evaluation run:
routing accuracy, schema conformance, quality pass rate, average latency, cost.

A `RunReport` stores the full run record including raw outputs and per-case judge results.
Reports can be diffed against a baseline to detect regressions.

## CLI entry points

```
npm run eval:smoke    # fast subset — core routing and schema checks only
npm run eval:full     # all bundles — full quality, latency, and cost comparison
```

`eval:smoke` is suitable for CI gates.
`eval:full` is for pre-release validation or post-config-change review.

## Relationship to regular tests

Evaluation runs are not a replacement for regression tests.

| | Tests | Eval runs |
|---|---|---|
| Purpose | correctness of code | quality of LLM behavior |
| Fixture type | code assertions | scenario + judgment |
| CI role | required gate | optional gate |
| Output | pass / fail | scorecard + diff |

## Provider comparison

Because the runner is provider-neutral, the same `EvalDataset` can be run
against different backend configurations.

This is the primary use case for evaluating whether switching from a cloud
provider to a local model (Ollama) degrades output quality for a given workload.

## Related docs

→ [Execute Dispatcher](./execute-dispatcher.md)
→ [Gateway / Direct Execution](./gateway-direct-execution.md)
→ [Execution Guardrails](./execution-guardrails.md)
