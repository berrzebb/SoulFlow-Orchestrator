# Design: Request Preflight Extraction (Phase 4.4)

> **Status**: Implementation complete · Request preprocessing consolidated into single module

## Overview

Extracts the request preprocessing logic from `OrchestrationService.execute()` into a dedicated `request-preflight.ts` module. Consolidates `seal_text`, `seal_list`, `inspect_secrets`, `resolve_context_skills`, `collect_skill_tool_names`, and context assembly into one code path.

Maintains:
- Semantic preservation (seal → resumed check → heavy context)
- Public API contract (`execute()` signature unchanged)
- Discriminated union return type for type-safe branching

## Problem Statement

`OrchestrationService.execute()` contains ~60 lines of preprocessing logic:
- L354-356: Seal inputs (text + list)
- L359-364: Resumed task branch
- L366-369: Skill resolution + secret validation
- L374-391: Context assembly

This inline logic prevents:
- Testing preflight in isolation
- Reusing preflight calculation in other contexts
- Clear separation of "gathering data" from "executing"

## Solution Architecture

### Module Structure

**File**: `src/orchestration/request-preflight.ts`

```typescript
// Types
export type RequestPreflightDeps = {
  vault: SecretVaultService;
  runtime: AgentRuntimeLike;
  policy_resolver: RuntimePolicyResolver;
  workspace: string | undefined;
  tool_index: ToolIndex | null;
};

export type ResumedPreflight = {
  kind: "resume";
  task_with_media: string;
  media: string[];
  resumed_task: TaskState;
};

export type ReadyPreflight = {
  kind: "ready";
  task_with_media: string;
  media: string[];
  skill_names: string[];
  secret_guard: { ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] };
  runtime_policy: RuntimeExecutionPolicy;
  // ... rest of context
};

export type RequestPreflightResult = ResumedPreflight | ReadyPreflight;

// Main function
export async function run_request_preflight(
  deps: RequestPreflightDeps,
  req: OrchestrationRequest,
): Promise<RequestPreflightResult>;

// Exported helper (used by continue_task_loop)
export function collect_skill_provider_prefs(
  runtime: AgentRuntimeLike,
  skill_names: string[],
): string[];
```

### Key Characteristics

- **Discriminated union**: Branching on `preflight.kind` instead of nested `if` statements
- **Semantic preservation**: `seal → resumed check → heavy context` order maintained
- **Module-internal helpers**: `seal_text`, `seal_list`, `inspect_secrets`, etc. not exported
- **Lazy context**: Context assembly only for `kind: "ready"` path

### Integration

**Modified**: `src/orchestration/service.ts`

```typescript
// 1. Constructor adds _preflight_deps()
private _preflight_deps(): RequestPreflightDeps {
  return {
    vault: this.vault,
    runtime: this.runtime,
    policy_resolver: this.policy_resolver,
    workspace: this.deps.workspace,
    tool_index: this.tool_index,
  };
}

// 2. execute() simplified to one call
async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
  const preflight = await run_request_preflight(this._preflight_deps(), req);

  if (preflight.kind === "resume") {
    return this.continue_task_loop(req, preflight.resumed_task, preflight.task_with_media, preflight.media);
  }

  if (!preflight.secret_guard.ok) {
    return { reply: format_secret_notice(preflight.secret_guard), mode: "once", ... };
  }

  const { task_with_media, media, skill_names, ... } = preflight;
  // Gateway routing continues with preflight data
}

// 3. _continue_deps() updated
collect_skill_provider_preferences: (names) => collect_skill_provider_prefs(this.runtime, names),
```

## Test Coverage

**File**: `tests/orchestration/request-preflight.test.ts` (7 tests)

Contract validation:
- `kind: "ready"` returned for normal path ✓
- ReadyPreflight contains all context fields ✓
- `collect_skill_provider_prefs` deduplicates providers ✓

**Regression**: 309+ tests pass (7 new + 302 existing)

## Semantic Preservation Checklist

✅ **Seal order preserved**: Text seal → list seal (inline methods removed, logic integrated)
✅ **Resumed branching**: Checked after seal, before heavy computation
✅ **Secret validation**: Early return for `ok: false`
✅ **Context assembly**: Only calculated for `kind: "ready"`
✅ **Public API**: `execute()` signature and behavior unchanged

## Files Changed

| File | Changes |
|------|---------|
| `src/orchestration/request-preflight.ts` | **NEW** (350 LOC: types + main function + 5 helpers) |
| `src/orchestration/service.ts` | 6 methods removed, execute() simplified, _preflight_deps() added, _continue_deps() updated |
| `tests/orchestration/request-preflight.test.ts` | **NEW** (7 tests) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.4 completion status |

## Validation

✅ TypeScript: `npx tsc -p tsconfig.json --noEmit`
✅ Tests: `npx vitest run tests/orchestration/request-preflight.test.ts` (7/7 pass)
✅ All tests: 309+ tests pass (no regressions)

## State of OrchestrationService

After Phase 4.1–4.4:
- **Inline state**: 0 (all injected: hitl_store, session_cd)
- **Preprocessing**: Moved to request-preflight module
- **Extracted logic**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **Remaining methods**: execute() dispatcher, security helpers, system prompt builder, renderer management

The service is now:
1. A dependency container (`_preflight_deps()`, `_runner_deps()`, `_continue_deps()`, `_phase_deps()`)
2. An orchestration facade (`execute()` routing + result finalization)
3. A stateful collaborator holder (hitl_store, session_cd)

## Next Steps

**Phase 4.5**: Extract execute() dispatcher logic
- `resolve_gateway()` result branching
- Mode routing (phase/once/agent/task)
- Finalization + event logging

## Design Decisions

1. **Discriminated Union over Conditional**: `kind: "resume" | "ready"` prevents type-unsafe branching
2. **Module-Level Helpers**: seal_text, build_context_message not exported (internal contract)
3. **Optional tool_index**: ToolIndex can be null (graceful degradation)
4. **Semantic Over Optimization**: Heavy context computed even for cases that branch early (clarity over micro-optimization)
