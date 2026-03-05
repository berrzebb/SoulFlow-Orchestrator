# Design: Interactive Phase + Fresh Context Loop

> **Status**: Implementation in progress

## Overview

Extends Phase Loop with two new execution modes beyond the default "parallel" mode:

1. **Interactive Mode** — Agent converses with the user to co-create a spec or gather requirements
2. **Sequential Loop Mode** — Same agent spawned repeatedly with fresh context per iteration (Ralph Loop pattern)

Both modes support **HITL (Human-in-the-Loop)** via the originating channel (Slack/Telegram/Dashboard).

## Motivation

The existing parallel mode runs all agents simultaneously and collects results. However, two critical workflows cannot be expressed:

- **Spec creation through conversation**: An agent asks the user clarifying questions, iterates on a spec, and outputs a finalized document. This requires back-and-forth interaction, not one-shot parallel execution.
- **Long-running implementation with fresh context**: A single task list is executed one item at a time, each in a fresh agent session to prevent context rot. Results accumulate externally, not in the agent's context window.

## Phase Execution Modes

```
mode: "parallel"         (default) — All agents run simultaneously
mode: "interactive"      — Single agent converses with user via channel
mode: "sequential_loop"  — Agent spawned repeatedly, fresh context per iteration
```

### Parallel (existing)

```
Phase: Research
  ├─ [Agent A] ──→ result A
  ├─ [Agent B] ──→ result B  ← all run at once
  └─ [Agent C] ──→ result C
       └─ [Critic] reviews all
```

### Interactive

```
Phase: Spec Creation
  ┌─ [Spec Writer] spawn #1
  │   output: [ASK_USER] What framework do you prefer?
  │   ← User: React
  │
  ├─ [Spec Writer] spawn #2 (fresh context + conversation history)
  │   output: [ASK_USER] Should we include SSR?
  │   ← User: Yes, Next.js
  │
  └─ [Spec Writer] spawn #N
      output: [SPEC_COMPLETE] { full spec document }
      → Phase complete, result passes to next phase
```

### Sequential Loop (Fresh Context)

```
Phase: Implementation
  ┌─ [Implementer] spawn #1 (task 1)
  │   output: "Completed auth module"
  │
  ├─ [Implementer] spawn #2 (task 2, fresh context + prev results)
  │   output: "Completed API endpoints"
  │
  ├─ [Implementer] spawn #3 (task 3)
  │   output: [ASK_USER] Which DB driver?
  │   ← User: PostgreSQL
  │
  └─ [Implementer] spawn #N
      output: [DONE]
      → Loop terminates
```

## Type Extensions

### PhaseDefinition

```typescript
interface PhaseDefinition {
  // existing fields...
  mode?: "parallel" | "interactive" | "sequential_loop";
  loop_until?: string;          // "plan_complete" | "max_iterations"
  max_loop_iterations?: number; // default: 20 (interactive), 50 (sequential_loop)
}
```

### PhaseState

```typescript
interface PhaseState {
  // existing fields...
  loop_iteration?: number;
  loop_results?: string[];
  pending_user_input?: boolean;
}
```

### PhaseLoopRunOptions

```typescript
interface PhaseLoopRunOptions {
  // existing fields...
  ask_user?: (question: string) => Promise<string>;
}
```

### New SSE Events

```typescript
| { type: "user_input_requested"; workflow_id: string; phase_id: string; question: string }
| { type: "user_input_received"; workflow_id: string; phase_id: string }
| { type: "loop_iteration"; workflow_id: string; phase_id: string; iteration: number }
```

## Agent Output Markers

| Marker | Mode | Effect |
|--------|------|--------|
| `[ASK_USER]` | interactive / sequential_loop | Pause workflow, send question to user's channel, await response |
| `[SPEC_COMPLETE]` | interactive | Terminate interactive phase, pass result to next phase |
| `[DONE]` | sequential_loop | Terminate loop |

## HITL Channel Integration

### ask_user Callback

```typescript
const ask_user = async (question: string): Promise<string> => {
  await send_to_channel(state.channel, state.chat_id, question);
  return new Promise((resolve) => {
    pending_responses.set(workflow_id, resolve);
  });
};
```

### Response Resolution

When a user sends a message to a workflow in `waiting_user_input` status, the pending Promise resolves and the workflow resumes.

### Channel Configuration

Workflows inherit the triggering channel/chat_id by default. Optional override via YAML:

```yaml
hitl_channel: "slack"
hitl_chat_id: "C1234567"
```

## Execution Flow

```
run_phase_loop(options)
  │
  for each phase:
  │
  ├─ mode = phase.mode || "parallel"
  │
  ├─ if mode === "interactive"
  │   → run_interactive_phase()
  │     loop: spawn agent → check markers → ask_user / accumulate → repeat
  │     exit: [SPEC_COMPLETE] or max_loop_iterations
  │
  ├─ if mode === "sequential_loop"
  │   → run_sequential_loop_phase()
  │     loop: spawn agent (fresh context + accumulated results) → check markers → repeat
  │     exit: [DONE] or max_loop_iterations
  │
  └─ else (parallel, default)
      → run_phase_agents() (existing)
```

## YAML Example

```yaml
title: "Autonomous Development Pipeline"
objective: "{{objective}}"

phases:
  - phase_id: "spec"
    title: "Spec Creation"
    mode: interactive
    max_loop_iterations: 20
    agents:
      - agent_id: "spec-writer"
        role: "pm"
        system_prompt: |
          Create an implementation spec through conversation with the user.
          Use [ASK_USER] to ask clarifying questions.
          Output [SPEC_COMPLETE] when the spec is finalized.

  - phase_id: "plan"
    title: "Implementation Planning"
    mode: parallel
    agents:
      - agent_id: "planner"
        role: "pl"
        system_prompt: "Break the spec into numbered atomic tasks."

  - phase_id: "implement"
    title: "Task Execution"
    mode: sequential_loop
    max_loop_iterations: 50
    agents:
      - agent_id: "implementer"
        role: "implementer"
        system_prompt: |
          Execute the next incomplete task from the plan.
          If blocked, use [ASK_USER] to ask the user.
          Output [DONE] when all tasks are complete.
        tools: ["shell", "file_request"]
```

## Autonomous Development Pipeline (Meta Workflow Template)

The culmination of interactive + sequential_loop modes: a complete autonomous development pipeline that mirrors the human workflow of "spec → plan → implement → review → fix → validate".

### Pipeline Structure

```
Phase 1: Spec Creation (interactive)
  └─ [PM] ←→ User — co-create implementation spec via conversation
       │
Phase 2: Planning (parallel)
  └─ [PL] — break spec into atomic tasks + team composition
       │        └─ Critic gate: plan completeness check
       │
Phase 3: Implementation (sequential_loop)
  └─ [Implementer] — execute tasks one-by-one, fresh context per iteration
       │                └─ [ASK_USER] if blocked
       │
Phase 4: Code Review (parallel)
  └─ [Reviewer] — review all changes for correctness, style, security
       │        └─ Critic gate: review thoroughness check
       │
Phase 5: Fix Issues (sequential_loop)
  └─ [Debugger] — fix each review issue one-by-one
       │            └─ Skip if no issues ([DONE] immediately)
       │
Phase 6: Validation (parallel)
  └─ [Validator] — build, test, type check, acceptance criteria
                 └─ Critic: overall verdict
```

### Role Auto-Injection

The template pre-defines the pipeline structure. Each phase automatically injects the appropriate role (pm, pl, implementer, reviewer, debugger, validator) from `src/skills/roles/`. The orchestrator doesn't need the user to manually assign agents — the meta template handles it.

Key principle: **structure is fixed, content is dynamic**. The PL's plan output determines what tasks the implementer executes, how many iterations are needed, and what the reviewer checks.

### Template File

`workspace/workflows/autonomous-dev-pipeline.yaml` — 6-phase meta template.

## Dashboard UX per Mode

Different phase modes require different card presentations:

### Parallel Mode (existing)

```
┌─ Phase: Research ────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│ │ Analyst  │ │ Scout    │ │ Writer   │  │
│ │ ✅ Done   │ │ 🔄 Run   │ │ ⏳ Wait   │  │
│ │ [Result] │ │ [Result] │ │          │  │
│ └──────────┘ └──────────┘ └──────────┘  │
│ ████████████░░░░░ 2/3 agents complete    │
└──────────────────────────────────────────┘
```

### Interactive Mode — Chat UI

```
┌─ Phase: Spec Creation ─── 🔄 Interactive ─┐
│                                             │
│  🤖 PM: What framework do you prefer?       │
│                              User: React 👤 │
│                                             │
│  🤖 PM: Should we include SSR?              │
│                      User: Yes, Next.js 👤  │
│                                             │
│  🤖 PM: Writing final spec...               │
│                                             │
│ ┌─────────────────────────────────┐ [Send] │
│ │ Type your response...           │         │
│ └─────────────────────────────────┘         │
│ Turn 3/20                                   │
└─────────────────────────────────────────────┘
```

### Sequential Loop Mode — Iteration Timeline

```
┌─ Phase: Implementation ── 🔁 Loop ────────┐
│                                             │
│  ✅ #1  Completed auth module          0:42 │
│  ✅ #2  Completed API endpoints        1:15 │
│  ❓ #3  [ASK_USER] Which DB driver?        │
│         └─ User: PostgreSQL                 │
│  🔄 #4  Implementing database layer...      │
│  ⏳ #5-8  Remaining                         │
│                                             │
│ ████████████░░░░░░ 4/50 iterations          │
└─────────────────────────────────────────────┘
```

## Phase Branching: Goto + Fork-Join

### Critic-Based Goto (Rollback)

The pipeline is NOT one-directional. When validation fails, the workflow must loop back:

```
implement → review → validate ──PASS──→ done
                       │
                      FAIL (critic rejects)
                       │
                       ↓ on_rejection: goto → goto_phase: "fix"
                      fix → review → validate (re-verify)
```

Extension to `PhaseCriticDefinition`:

```typescript
interface PhaseCriticDefinition {
  // existing...
  on_rejection?: "retry_all" | "retry_targeted" | "escalate" | "goto";
  goto_phase?: string;  // phase_id to jump to when on_rejection is "goto"
}
```

The main loop changes from linear iteration to a **phase_id-based state machine**:

```typescript
// Before: linear
for (let i = 0; i < phases.length; i++) { ... }

// After: state machine with jumps
let phase_idx = 0;
while (phase_idx < phases.length) {
  // ... execute phase ...
  if (critic rejected && on_rejection === "goto") {
    phase_idx = phases.findIndex(p => p.phase_id === goto_phase);
    // reset target phase state
    continue;
  }
  phase_idx++;
}
```

YAML example:
```yaml
- phase_id: "validate"
  critic:
    system_prompt: "Verify all tests pass..."
    gate: true
    on_rejection: goto
    goto_phase: "fix"    # jump back to fix phase on failure
    max_retries: 3       # max goto loops before escalating to user
```

### Fork-Join (Parallel Branches)

Multiple phases can run simultaneously. All must succeed before the next phase begins.

```
Phase: Research
  ├─ Branch A: codebase analysis  ─┐
  ├─ Branch B: API research        ├─ ALL must complete → Phase: Planning
  └─ Branch C: pattern scout      ─┘
```

Extension to `PhaseDefinition`:

```typescript
interface PhaseDefinition {
  // existing...
  depends_on?: string[];  // phase_ids that must complete before this phase starts
}
```

Phases with the same `depends_on` (or no `depends_on` in the same "layer") run concurrently. The runner collects all results before proceeding to dependent phases.

YAML example:
```yaml
- phase_id: "code-review"
  depends_on: ["implement"]
  agents: [...]

- phase_id: "security-review"
  depends_on: ["implement"]
  agents: [...]

- phase_id: "fix"
  depends_on: ["code-review", "security-review"]  # waits for BOTH
  agents: [...]
```

## Visual Graph Editor (Builder Evolution)

The builder evolves from a linear form to a **visual state machine editor**:

### Current: Linear Form Builder

```
Phase 1  ──────────→  Phase 2  ──────────→  Phase 3
[Form fields]        [Form fields]          [Form fields]
```

### Target: Node-Edge Graph Editor

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ┌──────┐     ┌──────┐     ┌──────────┐                │
│   │ Spec │────→│ Plan │────→│Implement │                │
│   │  🔄  │     │  ∥   │     │   🔁     │                │
│   └──────┘     └──────┘     └─────┬────┘                │
│                                   │                      │
│                      ┌────────────┼────────────┐         │
│                      ↓            ↓            ↓         │
│                ┌──────────┐ ┌──────────┐                 │
│                │Code Rev  │ │Sec Rev   │  ← fork         │
│                │  ∥       │ │  ∥       │                 │
│                └────┬─────┘ └────┬─────┘                 │
│                     └─────┬──────┘  ← join               │
│                           ↓                              │
│                     ┌──────────┐                         │
│                     │   Fix    │←────────┐               │
│                     │   🔁     │         │  ← goto loop  │
│                     └────┬─────┘         │               │
│                          ↓               │               │
│                     ┌──────────┐         │               │
│                     │ Validate │─FAIL───→┘               │
│                     │  ∥       │                         │
│                     └────┬─────┘                         │
│                          ↓ PASS                          │
│                       ✅ Done                             │
│                                                          │
│  Mode: 🔄 Interactive  ∥ Parallel  🔁 Sequential Loop   │
└──────────────────────────────────────────────────────────┘
```

### Interaction Model

1. **Drag nodes** to position phases on the canvas
2. **Draw edges** between nodes to set `depends_on` relationships
3. **Click node** to open phase config panel (agents, critic, mode)
4. **Goto edges** shown as dashed red lines with "on_fail" label
5. **Fork/Join** automatically detected from `depends_on` topology
6. **Auto YAML**: Every edit immediately regenerates the YAML representation
7. **Mode badges**: Each node shows its execution mode icon (🔄/∥/🔁)

### Data Flow

```
Graph Editor (visual) ←→ WorkflowDefinition (in-memory) ←→ YAML (serialized)
         ↕                          ↕
    Canvas render              API save/load
```

The graph editor is a **view** over `WorkflowDefinition`. All changes update the definition object, which can be serialized to YAML at any time. The YAML tab provides direct editing as an alternative.

### Multi-Node Types

In addition to Phase, 4 auxiliary node types are supported. Auxiliary nodes **attach** to Phases and define the execution environment for that Phase.

#### Node Types

| Type | Shape | Color | Role |
|------|-------|-------|------|
| Phase | Rounded rectangle | Blue (`--accent`) | Agent execution unit (existing) |
| Tool | Hexagon | Green (`--green`) | Tool binding for the Phase |
| Skill | Pentagon | Purple (`--purple`) | Built-in skill attachment |
| Cron | Circle | Orange (`--orange`) | Workflow trigger schedule |
| Channel | Diamond | Yellow (`--yellow`) | HITL I/O channel binding |

#### Connection Rules (Edge Types)

| Edge | Direction | Style | Meaning |
|------|-----------|-------|---------|
| flow | Phase → Phase | Solid arrow | `depends_on` execution order |
| goto | Phase → Phase | Red dashed | `on_fail` conditional branch |
| attach | Tool/Skill → Phase | Gray dotted | Adds ID to Phase's `tools[]`/`skills[]` |
| trigger | Cron → Phase | Orange dashed | Workflow start trigger |
| config | Channel → Workflow | Yellow dashed | HITL channel binding |

#### Extended Graph Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ⏰ Cron ─ ─ ─→ ┌──────┐     ┌──────┐                    │
│   (daily 9am)     │ Spec │────→│ Impl │                    │
│                   │  🔄  │     │  🔁  │                    │
│   💬 Channel      └──────┘     └──┬───┘                    │
│   (Slack) ─ ─ ─→  HITL binding    │                        │
│                          ┌────────┼────────┐                │
│                          ↓        ↓        ↓                │
│                    ┌────────┐ ┌────────┐                    │
│                    │Code Rev│ │Sec Rev │                    │
│                    └───┬────┘ └───┬────┘                    │
│                        └────┬─────┘                         │
│        ⬡ shell ·····→ ┌────────┐                           │
│        ⬡ web   ·····→ │  Fix   │ ← tool attach             │
│        ⬠ hwpx  ·····→ │  🔁   │ ← skill attach            │
│                       └────────┘                            │
│                                                             │
│  Nodes: ▭ Phase  ⬡ Tool  ⬠ Skill  ⏰ Cron  💬 Channel     │
└─────────────────────────────────────────────────────────────┘
```

#### Data Model Extension

New auxiliary node fields on `WorkflowDefinition`:

```typescript
interface WorkflowDefinition {
  // existing...
  tool_nodes?: Array<{ id: string; tool_id: string; description: string }>;
  skill_nodes?: Array<{ id: string; skill_name: string; description: string }>;
  trigger?: { type: "cron"; schedule: string; timezone?: string };
  hitl_channel?: { channel_type: string; chat_id?: string };
}
```

Phase `tools[]` / `skills[]` fields reference auxiliary node IDs:

```typescript
interface PhaseDefinition {
  // existing...
  tools?: string[];   // references tool_nodes[].tool_id
  skills?: string[];  // references skill_nodes[].skill_name
}
```

#### YAML Representation

```yaml
title: "Automated Code Review"
trigger:
  type: cron
  schedule: "0 9 * * *"
  timezone: "Asia/Seoul"
hitl_channel:
  channel_type: slack
  chat_id: "C1234567"
phases:
  - phase_id: "review"
    title: "Code Review"
    tools: ["shell", "web"]
    skills: ["hwpx"]
    agents:
      - agent_id: "reviewer"
        role: "reviewer"
        label: "Code Reviewer"
        backend: "claude_cli"
        system_prompt: "Review the code."
```

#### Layout Strategy

- **Tool/Skill** → Arranged vertically to the left of the attached Phase node
- **Cron** → Positioned above the first Phase node
- **Channel** → Fixed at the top-right of the canvas
- Phase layout (topological layers) is computed first, then auxiliary node positions are derived relative to their associated Phases

#### Builder UI

Node addition dropdown in the graph editor toolbar:

```
[+ Phase]  [+ Tool ▼]  [+ Skill ▼]  [⏰ Trigger]  [💬 Channel]
```

- **Tool**: `GET /api/tools` → Select from registered tool list
- **Skill**: `GET /api/skills` → Select from active skill list
- **Cron**: Opens schedule (cron expression) input modal
- **Channel**: `GET /api/channel-instances` → Channel instance dropdown

## Workflow Resume (State Persistence)

Every state mutation is persisted to SQLite via `store.upsert(state)`. This enables **resume from any point** after crashes, restarts, or `waiting_user_input` pauses.

### What is persisted

`PhaseLoopState` includes:
- `current_phase` — which phase index the state machine is at
- `phases[].status` — each phase's current status (pending/running/completed/failed)
- `phases[].agents[].result` — accumulated agent results
- `phases[].loop_iteration` / `loop_results` — loop mode progress
- `phases[].pending_user_input` — whether waiting for user
- `memory` — cross-phase accumulated data
- `definition` — original workflow definition for re-execution

### Resume flow

```
1. Load PhaseLoopState from DB by workflow_id
2. Find first phase where status !== "completed"
3. Re-create PhaseLoopRunOptions from state.definition
4. Call run_phase_loop() with existing state injected
   → State machine picks up from the incomplete phase
```

### Resume triggers

| Trigger | Scenario |
|---------|----------|
| User response | `waiting_user_input` → user sends message → `send_message()` resolves pending Promise → workflow resumes |
| Server restart | On startup, find workflows with `status: "running"` → resume each |
| Manual retry | Dashboard "Resume" button → re-invoke `run_phase_loop()` from current phase |

### Key constraint

The runner must be **idempotent**: re-running a completed phase is a no-op (the `while` loop skips phases with `status === "completed"`).

## Affected Files

| File | Change |
|------|--------|
| `src/agent/phase-loop.types.ts` | mode/loop fields, PhaseState loop state, new events, goto, depends_on |
| `src/agent/phase-loop-runner.ts` | run_interactive_phase(), run_sequential_loop_phase(), main loop branch |
| `src/dashboard/ops-factory.ts` | ask_user callback, pending response resolution |
| `src/orchestration/workflow-loader.ts` | Parse mode/loop fields in normalize |
| `web/src/pages/workflows/builder.tsx` | Phase mode dropdown + loop settings |
| `web/src/i18n/ko.ts`, `en.ts` | Mode-related i18n keys |

## Related Docs

→ [Phase Loop](./phase-loop.md)
→ [Loop Continuity & HITL](./loop-continuity-hitl.md)
