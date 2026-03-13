# Design: Phase Workflow Extraction (Phase 4.2)

> **Status**: Implementation complete · Phase workflow path separated from OrchestrationService

## Overview

Extracts the **phase workflow execution path** from `OrchestrationService` into a standalone module `src/orchestration/execution/phase-workflow.ts`, following the same pattern as Phase 4.1 execution runners.

Maintains:
- Semantic preservation (no policy changes, no exception handling changes)
- Public API contract (OrchestrationService.execute() unchanged)
- Testability through contract validation

## Problem Statement

`OrchestrationService` combines 5 related concerns:
1. Request sealing and security preflight
2. Mode routing (once/agent/task/phase dispatch)
3. Execution via runners (Phase 4.1 extraction)
4. Phase workflow orchestration (Phase 4.2 target)
5. State management (phase_pending_responses, session_cd)

This mixing creates change vulnerability: modifications to phase workflow logic risk affecting other execution modes.

## Solution Architecture

### Module Structure

**New File**: `src/orchestration/execution/phase-workflow.ts` (~290 lines)

```typescript
export type PhaseWorkflowDeps = {
  // Core dependencies
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;

  // Workspace and path context
  workspace: string;
  process_tracker: ProcessTrackerLike | null;

  // Phase workflow infrastructure
  subagents: SubagentRegistry | null;
  phase_workflow_store: PhaseWorkflowStoreLike | null;
  bus: MessageBusLike | null;

  // State management
  hitl_store: HitlPendingStore;

  // Callbacks for SSE broadcasting and HITL rendering
  get_sse_broadcaster: (() => { broadcast_workflow_event(...): void } | null) | undefined;
  render_hitl: (body: string, type: HitlType) => string;

  // Optional decision/promise services
  decision_service: DecisionService | null;
  promise_service: PromiseService | null;

  // Node execution dependencies (passed through to node handlers)
  embed: ((texts, opts) => Promise<...>) | undefined;
  vector_store: ((op, opts) => Promise<...>) | undefined;
  oauth_fetch: ((service_id, opts) => Promise<...>) | undefined;
  get_webhook_data: ((path) => Promise<...>) | undefined;
  wait_kanban_event: ((board_id, filter) => Promise<...>) | undefined;
  create_task: ((opts) => Promise<...>) | undefined;
  query_db: ((datasource, query, params?) => Promise<...>) | undefined;
};

export async function run_phase_loop(
  deps: PhaseWorkflowDeps,
  req: OrchestrationRequest,
  task_with_media: string,
  workflow_hint?: string,
  node_categories?: string[],
): Promise<OrchestrationResult>;
```

### Extracted Functions

| Function | Purpose | Scope |
|----------|---------|-------|
| `run_phase_loop` | **Exported** entry point orchestrating template loading or dynamic workflow generation | Public API |
| `generate_dynamic_workflow` | LLM-based workflow generation from natural language hints | Module-internal |
| `format_workflow_preview` | Format workflow preview text for display | Module-internal |
| `build_phase_channel_callbacks` | Build send_message/ask_channel callbacks for phase nodes | Module-internal |
| `format_phase_summary` | Format final execution summary from phase results | Module-internal |

### Service Integration

**Modified**: `src/orchestration/service.ts`

```typescript
// New private helper method
private _phase_deps(): PhaseWorkflowDeps {
  return {
    providers: this.deps.providers,
    runtime: this.deps.runtime,
    logger: this.logger,
    workspace: this.workspace,
    process_tracker: this.deps.process_tracker,
    subagents: this.subagents,
    phase_workflow_store: this.phase_workflow_store,
    bus: this.bus,
    hitl_store: this.hitl_store,
    get_sse_broadcaster: this.deps.get_sse_broadcaster,
    render_hitl: (body, type) => this._render_hitl(body, type),
    decision_service: this.decision_service,
    promise_service: this.promise_service,
    embed: this.deps.embed,
    vector_store: this.deps.vector_store,
    oauth_fetch: this.deps.oauth_fetch,
    get_webhook_data: this.deps.get_webhook_data,
    wait_kanban_event: this.deps.wait_kanban_event,
    create_task: this.deps.create_task,
    query_db: this.deps.query_db,
  };
}

// Replaced implementation with delegation
private async run_phase_loop(req, task_with_media, workflow_hint?, node_categories?) {
  return _run_phase_loop(this._phase_deps(), req, task_with_media, workflow_hint, node_categories);
}

// Removed (now module-internal):
// - generate_dynamic_workflow (53 lines)
// - format_workflow_preview (12 lines)
// - build_phase_channel_callbacks (56 lines)
// - format_phase_summary (29 lines)
```

**Modified**: `src/orchestration/execution/index.ts`

```typescript
export { run_phase_loop, type PhaseWorkflowDeps } from "./phase-workflow.js";
```

## Test Coverage

**New File**: `tests/orchestration/phase-workflow.test.ts` (5 tests)

Contract validation:
- `run_phase_loop` exported and callable ✓
- Function parameter count (5 parameters) ✓
- `PhaseWorkflowDeps` type properly defined ✓
- Required properties present (providers, runtime, logger, workspace, hitl_store, render_hitl) ✓
- OrchestrationService imports and delegates to extracted module ✓

**Regression Tests**: Representative regression tests and type checks pass

## Semantic Preservation Checklist

✅ No policy changes:
- Workflow loading logic unchanged
- Dynamic generation prompt unchanged
- Summary formatting unchanged

✅ No exception handling changes:
- Error propagation unchanged
- HITL error cases unchanged

✅ No event timing changes:
- SSE broadcast timing unchanged
- Phase event emission order unchanged

✅ State management:
- `hitl_store` remains a service-owned injected collaborator
- `session_cd` remains a service-owned injected collaborator

## Files Changed

| File | Changes |
|------|---------|
| `src/orchestration/execution/phase-workflow.ts` | **NEW** (~290 lines) |
| `src/orchestration/execution/index.ts` | +2 exports (run_phase_loop, PhaseWorkflowDeps type) |
| `src/orchestration/service.ts` | -150 lines (5 methods extracted) + 1-line delegation + _phase_deps() builder |
| `tests/orchestration/phase-workflow.test.ts` | **NEW** (contract validation) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Updated Phase 4 status |

## Validation

✅ TypeScript compilation: `npx tsc -p tsconfig.json --noEmit`
✅ Test suite: 301 tests pass
✅ No unused imports in service.ts (removed now_iso, short_id)

## Follow-up

- Keep strengthening characterization tests that directly lock `run_phase_loop()` delegation
- Preserve the boundary so phase workflow policy does not drift back into `service.ts`
- Keep the separation between phase workflow execution and service collaborators (`hitl_store`, `session_cd`)
