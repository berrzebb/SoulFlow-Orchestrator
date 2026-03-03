import { describe, it, expect } from "vitest";
import { AgentLoopStore } from "@src/agent/loop.service.ts";
import type { TaskState } from "@src/contracts.ts";

function make_store(): AgentLoopStore {
  return new AgentLoopStore();
}

function seed_task(store: AgentLoopStore, patch?: Partial<TaskState>): TaskState {
  const task: TaskState = {
    taskId: "task-1",
    title: "Test Task",
    currentTurn: 5,
    maxTurns: 40,
    status: "waiting_user_input",
    currentStep: "execute",
    memory: { objective: "추천곡 재생" },
    ...patch,
  };
  // AgentLoopStore.tasks는 private이므로 run_task_loop을 통해 주입하기 어려움
  // 대신 resume_task가 null을 반환하는 케이스를 검증
  return task;
}

describe("AgentLoopStore.resume_task", () => {
  it("존재하지 않는 task_id → null", async () => {
    const store = make_store();
    const result = await store.resume_task("nonexistent");
    expect(result).toBeNull();
  });

  it("waiting_user_input → running + __user_input 주입", async () => {
    const store = make_store();
    // run_task_loop으로 task를 생성 후 waiting_user_input으로 종료
    const result = await store.run_task_loop({
      task_id: "task-resume-1",
      title: "Resume Test",
      nodes: [
        {
          id: "step1",
          run: async () => ({
            status: "waiting_user_input" as const,
            memory_patch: { objective: "pick a song", last_output: "1. A\n2. B\n3. C" },
            current_step: "step1",
            exit_reason: "waiting_user_input",
          }),
        },
      ],
      max_turns: 10,
    });

    expect(result.state.status).toBe("waiting_user_input");

    // resume
    const resumed = await store.resume_task("task-resume-1", "2번", "user_input_received");
    expect(resumed).not.toBeNull();
    expect(resumed!.status).toBe("running");
    expect(resumed!.memory.__user_input).toBe("2번");
    expect(resumed!.memory.__resumed_at).toBeTruthy();
  });

  it("completed Task은 재개 불가 (상태 그대로 반환)", async () => {
    const store = make_store();
    await store.run_task_loop({
      task_id: "task-completed",
      title: "Done Task",
      nodes: [
        {
          id: "done",
          run: async () => ({
            status: "completed" as const,
            memory_patch: {},
            current_step: "done",
            exit_reason: "done",
          }),
        },
      ],
      max_turns: 10,
    });

    const resumed = await store.resume_task("task-completed", "추가 입력");
    expect(resumed).not.toBeNull();
    expect(resumed!.status).toBe("completed");
    // __user_input이 주입되지 않아야 함
    expect(resumed!.memory.__user_input).toBeUndefined();
  });

  it("cancelled Task은 재개 불가", async () => {
    const store = make_store();
    await store.run_task_loop({
      task_id: "task-cancel",
      title: "Cancel Task",
      nodes: [
        {
          id: "wait",
          run: async () => ({
            status: "waiting_user_input" as const,
            memory_patch: {},
            current_step: "wait",
            exit_reason: "waiting",
          }),
        },
      ],
      max_turns: 10,
    });

    store.cancel_task("task-cancel");
    const resumed = await store.resume_task("task-cancel", "입력");
    expect(resumed).not.toBeNull();
    expect(resumed!.status).toBe("cancelled");
  });

  it("maxTurns에 도달한 Task은 재개 시 확장", async () => {
    const store = make_store();
    await store.run_task_loop({
      task_id: "task-extend",
      title: "Extend Task",
      nodes: Array.from({ length: 5 }, (_, i) => ({
        id: `step-${i}`,
        run: async () => ({
          memory_patch: {},
          next_step_index: i < 4 ? i + 1 : undefined,
          current_step: `step-${i}`,
          ...(i === 4 ? { status: "waiting_user_input" as const, exit_reason: "waiting" } : {}),
        }),
      })),
      max_turns: 5,
    });

    const before = store.get_task("task-extend");
    expect(before!.currentTurn).toBe(5);
    expect(before!.maxTurns).toBe(5);

    const resumed = await store.resume_task("task-extend", "계속");
    expect(resumed!.status).toBe("running");
    // maxTurns가 확장되어야 함 (25% 이상)
    expect(resumed!.maxTurns).toBeGreaterThan(5);
  });
});
