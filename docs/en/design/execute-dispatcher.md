# Design: Execute Dispatcher Extraction (Phase 4.5)

> **Status**: Implementation complete · Execute dispatcher consolidated into single module

## Overview

Extracts the dispatcher logic from `OrchestrationService.execute()` into a dedicated `execute-dispatcher.ts` module. Consolidates gateway routing, short-circuit branches (identity/builtin/inquiry), mode dispatch (phase/once/agent/task), and finalize orchestration into one code path with proper dependency injection.

Maintains:
- Semantic preservation (gateway → short-circuit → mode dispatch → finalize)
- Public API contract (`execute()` signature unchanged)
- Dependency injection pattern for testability

## Problem Statement

`OrchestrationService.execute()` contains ~180 lines of dispatcher logic:
- L374–401: Gateway routing decision
- L403–417: Short-circuit branches (identity/builtin/inquiry early returns)
- L422–436: Finalize closure (event logging + process tracker)
- L438–459: Mode dispatch (phase / once / agent / task)
- L480–526: Escalation handling and executor fallback

This inline logic prevents:
- Testing dispatcher in isolation
- Reusing dispatcher logic in other contexts
- Clear separation of "data gathering" (preflight) from "execution dispatch"

## Solution Architecture

### Module Structure

**File**: `src/orchestration/execution/execute-dispatcher.ts`

```typescript
// Dependency injection type
export type ExecuteDispatcherDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;
  config: {
    executor_provider: ExecutorProvider;
    provider_caps?: ProviderCapabilities;
  };
  process_tracker: ProcessTrackerLike | null;
  guard: ConfirmationGuard | null;
  tool_index: ToolIndex | null;
  log_event: (input: AppendWorkflowEventInput) => void;
  build_identity_reply: () => string;
  build_system_prompt: (names: string[], provider: string, chat_id: string, cats?: ReadonlySet<string>, alias?: string) => Promise<string>;
  generate_guard_summary: (task_text: string) => Promise<string>;
  run_once: (args: RunExecutionArgs) => Promise<OrchestrationResult>;
  run_agent_loop: (args: RunExecutionArgs & { media: string[]; history_lines: string[] }) => Promise<OrchestrationResult>;
  run_task_loop: (args: RunExecutionArgs & { media: string[] }) => Promise<OrchestrationResult>;
  run_phase_loop: (req: OrchestrationRequest, task_with_media: string, workflow_hint?: string, node_categories?: string[]) => Promise<OrchestrationResult>;
  caps: () => ProviderCapabilities;
};

// Main function
export async function execute_dispatch(
  deps: ExecuteDispatcherDeps,
  req: OrchestrationRequest,
  preflight: ReadyPreflight,
): Promise<OrchestrationResult>
```

### Key Characteristics

- **Dependency injection**: All external calls provided as function references via deps
- **Semantic preservation**: gateway routing → short-circuit → mode dispatch → finalize order maintained
- **Type safety**: ReadyPreflight discriminated union ensures only ready-state fields are available
- **Lazy evaluation**: Tool selection and system prompt building happen only when needed
- **Finalize closure**: Event logging and process tracker updates wrapped in finalized step

### Integration

**Modified**: `src/orchestration/service.ts`

```typescript
// 1. Add _dispatch_deps() method
private _dispatch_deps(): ExecuteDispatcherDeps {
  return {
    providers: this.providers,
    runtime: this.runtime,
    logger: this.logger,
    config: { executor_provider: this.config.executor_provider, provider_caps: this.config.provider_caps },
    process_tracker: this.process_tracker,
    guard: this.guard,
    tool_index: this.tool_index,
    log_event: (e) => this.log_event(e),
    build_identity_reply: () => this._build_identity_reply(),
    build_system_prompt: (names, prov, chat, cats, alias) => this._build_system_prompt(names, prov, chat, cats, alias),
    generate_guard_summary: (text) => this._generate_guard_summary(text),
    run_once: (args) => _run_once(this._runner_deps(), args),
    run_agent_loop: (args) => _run_agent_loop(this._runner_deps(), args),
    run_task_loop: (args) => _run_task_loop(this._runner_deps(), args),
    run_phase_loop: (req, task, hint, cats) => _run_phase_loop(this._phase_deps(), req, task, hint, cats),
    caps: () => this._caps(),
  };
}

// 2. Simplified execute()
async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
  const preflight = await run_request_preflight(this._preflight_deps(), req);

  if (preflight.kind === "resume") {
    return this.continue_task_loop(req, preflight.resumed_task, preflight.task_with_media, preflight.media);
  }

  if (!preflight.secret_guard.ok) {
    return { reply: format_secret_notice(preflight.secret_guard), mode: "once", tool_calls_count: 0, streamed: false };
  }

  return execute_dispatch(this._dispatch_deps(), req, preflight);
}

// 3. Removed methods
// - run_once
// - run_agent_loop
// - run_task_loop
// - run_phase_loop
```

## Test Coverage

**File**: `tests/orchestration/execute-dispatcher.test.ts` (7 structural tests)

Contract validation:
- Dispatcher receives ExecuteDispatcherDeps ✓
- Dispatcher receives ReadyPreflight with all required fields ✓
- Dependency injection pattern works (build_identity_reply callable) ✓
- run_once can be called with RunExecutionArgs ✓
- log_event can be called for event recording ✓
- finalize closure records done/blocked events ✓
- ReadyPreflight discriminated union type is available ✓

**Regression**: 316+ tests pass (7 new + 309 existing)

## Semantic Preservation Checklist

✅ **Gateway routing first**: active_tasks_in_chat → resolve_gateway decision
✅ **Short-circuit returns early**: identity/builtin/inquiry branches exit before tool selection
✅ **Finalize wraps results**: done/blocked event logging + process_tracker teardown
✅ **Mode dispatch split**: phase branches before tool selection, once/agent/task after
✅ **Escalation preserved**: once → task, agent → task escalation logic intact
✅ **Executor fallback**: claude_code → chatgpt fallback when available
✅ **Public API**: `execute()` signature unchanged, return type unchanged

## Files Changed

| File | Changes |
|------|---------|
| `src/orchestration/execution/execute-dispatcher.ts` | **NEW** (300+ LOC: types + main function) |
| `src/orchestration/service.ts` | 4 methods removed (run_once, run_agent_loop, run_task_loop, run_phase_loop), dead code 4 functions removed, execute() simplified, _dispatch_deps() added |
| `tests/orchestration/execute-dispatcher.test.ts` | **NEW** (7 structural tests) |
| `docs/en/design/execute-dispatcher.md` | **NEW** |
| `docs/ko/design/execute-dispatcher.md` | **NEW** |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.5 completion status |

## Validation

✅ TypeScript: `npx tsc -p tsconfig.json --noEmit`
✅ Tests: `npx vitest run tests/orchestration/execute-dispatcher.test.ts` (7/7 pass)
✅ All tests: 316+ tests pass (no regressions)

## State of OrchestrationService

After Phase 4.1–4.5:
- **Inline state**: 0 (all injected: hitl_store, session_cd, dispatcher logic)
- **Preprocessing**: Moved to request-preflight module
- **Dispatching**: Moved to execute-dispatcher module
- **Extracted logic**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **Remaining methods**: execute() dispatcher entry point, security/prompt/renderer helpers, state management

The service is now:
1. A dependency container (_preflight_deps, _runner_deps, _continue_deps, _phase_deps, _dispatch_deps)
2. An orchestration facade (execute routing + finalization)
3. A stateful collaborator holder (hitl_store, session_cd)

## Next Steps

**Phase 4.6** (if needed): Extract execute() dispatcher routing logic
- Separate resolve_gateway result dispatching from finalize
- Move gateway decision result handling to dedicated collaborator

## Design Decisions

1. **Function refs over wrapper methods**: _dispatch_deps() returns function references instead of wrapper methods for cleaner dependency graph
2. **Deps parameter pattern**: Follows RunnerDeps pattern for consistency across executor modules
3. **Optional process_tracker/guard**: Gracefully handles null collaborators (composable design)
4. **Semantic preservation over optimization**: Heavy context computed in finalize closure even for early branches (for clarity over micro-optimization)
5. **ReadyPreflight only**: Dispatcher only receives ReadyPreflight (resume and secret_guard handled before dispatch)
