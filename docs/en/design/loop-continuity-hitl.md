# Design: Agent Loop Continuity + Task HITL

> **Status**: Implemented

## Problem

### 1. Agent Loop Premature Termination

Agent loops exit after 1 turn regardless of task completion.

**Root cause A — `check_should_continue` hard-coded to stop:**

```typescript
// src/orchestration/service.ts:508
check_should_continue: async ({ state }) => {
  if (state.currentTurn > 1) return false;  // always stops after turn 1
  return AGENT_TOOL_NUDGE;
},
```

**Root cause B — ContainerCliAgent exits immediately after CLI `complete`:**

```typescript
// src/agent/pty/container-cli-agent.ts:151-164
if (result.type === "complete") {
  const followups = this.bus.lane_queue.drain_followups(session_key);
  if (followups.length > 0) { continue; }      // only continues if pre-queued
  const collected = this.bus.lane_queue.drain_collected(session_key);
  if (collected) { continue; }                  // only continues if pre-collected
  return this.build_result(last_content, "stop", ...);  // no wait mechanism
}
```

**Expected behavior:** Loop continues until:
- Work is complete (agent signals "done")
- Max turns reached
- HITL condition not met
- Abort signal

### 2. Task HITL Not Connected

Task mode has mailbox injection (`loop.service.ts:inject_message`) and resume service (`task-resume.service.ts`), but:

- ContainerCliAgent's PTY loop is **not connected** to `inject_message` mailbox
- `register_send_input` callback queues to followups, but loop has already exited on `complete`
- User message arrives → task resume attempted → loop already terminated → injection fails

**Expected behavior:** During task execution, user messages should be injectable via HITL (approval, direction change, additional input).

---

## Architecture Gap

```
Current:
  User message → TaskResumeService → inject_message(loop_id) → mailbox
                                                                  ↓
  ContainerCliAgent.run() → while loop → complete → [NO CONNECTION] → exit

Expected:
  User message → TaskResumeService → inject_message(loop_id) → mailbox
                                                                  ↓
  ContainerCliAgent.run() → while loop → complete → wait for input → continue
                                                      ↑
                                              mailbox → followup queue bridge
```

---

## Proposed Solutions

### Option A: Minimal Fix (within existing architecture)

1. **`check_should_continue`**: Replace hard-coded `return false` with actual completion detection
   - Check if the agent's response contains completion signals
   - Allow configurable max turns per mode

2. **ContainerCliAgent wait mechanism**: After `complete`, wait briefly for followup injection
   ```typescript
   if (result.type === "complete") {
     // existing followup/collected checks...

     // NEW: wait for potential HITL injection (task mode only)
     if (options.wait_for_input) {
       const injected = await this.wait_for_followup(session_key, timeout_ms);
       if (injected) { current_prompt = injected; continue; }
     }

     return this.build_result(...);
   }
   ```

3. **Mailbox → followup bridge**: Connect `loop.service.inject_message` to `bus.queue_followup`

### Option B: Architecture Refinement

1. **Unify task/agent loop**: Both modes use TaskNode workflow
2. **PTY backend as executor**: ContainerCliAgent becomes a pure executor within TaskNode
3. **HITL as TaskNode state**: `waiting_user_input` state pauses execution, resumes on input

### Option C: Event-driven continuation

1. **Completion evaluator**: After agent `complete`, a lightweight evaluator checks if the original task is satisfied
2. **Auto-continue**: If not satisfied, generate a continuation prompt and feed back into the loop
3. **HITL events**: Expose an event bus for user input injection during any execution mode

---

## Affected Files

| File | Responsibility |
|------|----------------|
| `src/orchestration/service.ts` | `check_should_continue`, `run_agent_loop`, `run_task_loop` |
| `src/agent/pty/container-cli-agent.ts` | PTY execution loop, followup drain |
| `src/agent/loop.service.ts` | Task loop, mailbox injection |
| `src/channels/task-resume.service.ts` | HITL resume flow |
| `src/channels/manager.ts` | Active run management, message routing |
| `src/agent/pty/lane-queue.ts` | Followup/collect queue |

## Related Docs

→ [PTY Agent Backend](./pty-agent-backend.md) — container execution architecture
→ [Phase Loop Design](./phase-loop.md) — task node workflow
