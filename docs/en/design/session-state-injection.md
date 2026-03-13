# Design: Session CD Collaborator Injection (Phase 4.3)

> **Status**: Implementation complete · `session_cd` converted to required collaborator injection

## Overview

Completes the service decomposition by removing the last inline state creation (`session_cd`) from `OrchestrationService` and making it injectable via dependency injection.

Maintains:
- Semantic preservation (no CD scoring rule changes)
- Public API contract (`get_cd_score()`, `reset_cd_score()` unchanged)
- Explicit bootstrap ownership of collaborator lifecycle

## Problem Statement

`OrchestrationService` has one remaining inline state creation:
```typescript
private readonly session_cd = create_cd_observer();  // inline creation
```

This prevents:
- Injection of custom/mock CD observers in tests
- External lifecycle management of the session state
- Complete dependency injection pattern

All other dependencies are already injected via `OrchestrationServiceDeps`.

## Solution Architecture

### Module Structure

**Updated File**: `src/orchestration/service.ts`

The `CDObserver` interface already defines the necessary contract:
```typescript
export type CDObserver = {
  observe: (event: AgentEvent) => CDEvent | null;
  get_score: () => { total: number; events: CDEvent[] };
  reset: () => void;
};
```

### Dependency Injection Pattern

**Modified**: `src/orchestration/service.ts`

```typescript
// 1. Import CDObserver type
import { type CDObserver } from "../agent/cd-scoring.js";

// 2. Add required session_cd to OrchestrationServiceDeps
export type OrchestrationServiceDeps = {
  // ... existing fields
  /** Session CD observer. Must be injected by bootstrap. */
  session_cd: CDObserver;
  // ...
};

// 3. Class field declaration with type
private readonly session_cd: CDObserver;

// 4. Constructor injection
constructor(deps: OrchestrationServiceDeps) {
  // ...
  this.session_cd = deps.session_cd;
  // ...
}
```

### Key Characteristics

- **Required injection**: `session_cd: CDObserver` removes inline creation from the service
- **Explicit lifecycle**: bootstrap owns observer creation and lifetime
- **All accesses unchanged**: Internal code paths remain identical (`this.session_cd`)

## Test Coverage

**New File**: `tests/orchestration/session-state.test.ts` (6 tests)

Contract validation:
- `CDObserver` type properly defined ✓
- `OrchestrationServiceDeps.session_cd` required field present ✓
- Public API methods (`get_cd_score()`, `reset_cd_score()`) still available ✓
- Collaborator injection pattern works ✓

**Regression Tests**: 309 tests pass (6 new + 303 existing)

## Semantic Preservation Checklist

✅ No CD scoring rule changes:
- `observe()` behavior unchanged
- `get_score()` calculation unchanged
- `reset()` functionality unchanged

✅ Public API unchanged:
- `get_cd_score()` returns same structure
- `reset_cd_score()` clears state same way

✅ Integration unchanged:
- `hooks_deps.session_cd` passed to `build_agent_hooks` same way
- `runner_deps.session_cd` passed to execution runners same way
- Tool event observation paths unchanged

✅ Explicit assembly responsibility:
- `session_cd` creation belongs to bootstrap, not the service
- `new OrchestrationService(deps)` always receives a complete collaborator set
- The inline `create_cd_observer()` path is removed

## Files Changed

| File | Changes |
|------|---------|
| `src/orchestration/service.ts` | +import CDObserver, +required session_cd field in OrchestrationServiceDeps, ~constructor injection pattern |
| `tests/orchestration/session-state.test.ts` | **NEW** (6 tests: type contract + injection validation) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.3 completion status |

## Validation

✅ TypeScript compilation: `npx tsc -p tsconfig.json --noEmit`
✅ Test suite: 309 tests pass (22 test files)
✅ Explicit bootstrap injection path verified

## State of OrchestrationService

After Phase 4.1, 4.2, and 4.3:
- **Inline state**: 0 (all moved to injection or lazy init)
- **Injected state**: hitl_store, session_cd (collaborators)
- **Lazy-initialized state**: _renderer (caching only)
- **Extracted logic**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **Remaining methods**: execute(), security helpers, system prompt builder, renderer management, result conversion

The service is now primarily a coordinator and facade that:
1. Accepts requests via `execute()`
2. Manages stateful collaborators (hitl_store, session_cd)
3. Delegates execution to extracted module-level functions
4. Handles request preprocessing and response finalization

## Follow-up

- Keep `session_cd` as an injected collaborator rather than service-owned state
- Prevent non-bootstrap call sites from reintroducing ad-hoc observer creation
- Add regression coverage so tests do not depend on fallback creation paths again
