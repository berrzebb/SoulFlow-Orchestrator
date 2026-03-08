# Large File Split Design

> Status: Completed · English maintenance mirror  
> Canonical source: `docs/LARGE_FILE_SPLIT_DESIGN.md`

## Purpose

This document summarizes the large-file split effort.
The goal was not to make files look cleaner, but to reduce change fragility while preserving runtime behavior.

Two goals drove the work:

- clarify composition boundaries without changing system semantics
- split safely without undermining the automated development pipeline this project is built around

## Core Judgment

Splitting through a `bootstrap` layer was the right direction.
However, `bootstrap` must remain a composition layer, not a new dumping ground.

Allowed in `bootstrap`:

- object creation order
- runtime bundle assembly
- startup/shutdown lifecycle wiring

Not allowed in `bootstrap`:

- business rules
- workflow execution logic
- channel/provider/domain policies
- dashboard route logic
- tool/node registry semantics

## Why Large Files Were a Risk

The problem was never line count by itself.
The real risks were:

- initialization ordering dependencies
- shutdown ordering dependencies
- deferred binding left inside composition
- state and side effects mixed in the same file
- drift between generators, registries, and executors

## Result Summary

### Phase 2. Low-risk Split

Completed.

- `src/dashboard/ops-factory.ts` was reduced to a facade
- real implementations moved into `src/dashboard/ops/`

### Phase 3. Composition Split

Completed.

Most of `main.ts` was split into bootstrap bundles under `src/bootstrap/`.

- `config.ts`
- `runtime-paths.ts`
- `providers.ts`
- `runtime-data.ts`
- `agent-core.ts`
- `channels.ts`
- `channel-wiring.ts`
- `orchestration.ts`
- `workflow-ops.ts`
- `dashboard.ts`
- `runtime-tools.ts`
- `trigger-sync.ts`
- `services.ts`
- `lifecycle.ts`

What remains in `main.ts` is acceptable composition-root work:

- final `RuntimeApp` assembly
- main entry boot / lock / shutdown wiring

### Phase 4. Execution Split

Completed.

- `Phase 4.1`: execution runners
- `Phase 4.2`: phase workflow path
- `Phase 4.3`: `session_cd` state holder
- `Phase 4.4`: request preflight
- `Phase 4.5`: execute dispatcher

Main extracted modules:

- `src/orchestration/execution/run-once.ts`
- `src/orchestration/execution/run-agent-loop.ts`
- `src/orchestration/execution/run-task-loop.ts`
- `src/orchestration/execution/continue-task-loop.ts`
- `src/orchestration/execution/phase-workflow.ts`
- `src/orchestration/execution/execute-dispatcher.ts`
- `src/orchestration/request-preflight.ts`

## Current State

The structural split phases are complete.

Current file posture:

- `src/main.ts`: reduced to composition-root scope
- `src/dashboard/ops-factory.ts`: reduced to a re-export facade
- `src/orchestration/service.ts`: still important, but now primarily a facade over extracted collaborators

The remaining work is no longer “large-file splitting”.
It is stabilization work:

- strengthening regression tests
- cleanup and import hygiene
- keeping docs aligned with the new boundaries

## Rules That Still Matter

Even after the split, the following rules remain important:

- keep facades stable
- preserve public contracts
- preserve side-effect ordering
- split stateful objects last
- never mix structural refactors with behavior changes in the same change set

## Recommended Follow-up

1. strengthen characterization tests around bootstrap and execution boundaries
2. add more representative regression tests for `OrchestrationService.execute()`
3. watch import cycles across the new bootstrap/execution layers
4. land new features on top of the new boundaries instead of bypassing them
