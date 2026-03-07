import { describe, it, expect, vi } from "vitest";
import { ProcessTracker } from "@src/orchestration/process-tracker.js";
import type { CancelStrategy, ProcessEntry } from "@src/orchestration/process-tracker.js";

function make_params(overrides?: Partial<{ provider: string; chat_id: string; alias: string; sender_id: string }>) {
  return {
    provider: "telegram" as const,
    chat_id: "ch1",
    alias: "default",
    sender_id: "user1",
    ...overrides,
  };
}

describe("ProcessTracker", () => {
  describe("start / get / end 기본 흐름", () => {
    it("start → running 상태의 엔트리 생성", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      const entry = tracker.get(id);
      expect(entry).not.toBeNull();
      expect(entry!.status).toBe("running");
      expect(entry!.provider).toBe("telegram");
      expect(entry!.mode).toBe("once");
    });

    it("end → completed 상태로 전환 + active에서 제거", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.end(id, "completed");
      expect(tracker.list_active()).toHaveLength(0);
      const entry = tracker.get(id);
      expect(entry!.status).toBe("completed");
      expect(entry!.ended_at).toBeTruthy();
    });

    it("end with error", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.end(id, "failed", "timeout");
      const entry = tracker.get(id);
      expect(entry!.status).toBe("failed");
      expect(entry!.error).toBe("timeout");
    });

    it("없는 run_id end → 무시", () => {
      const tracker = new ProcessTracker();
      expect(() => tracker.end("nonexistent", "completed")).not.toThrow();
    });
  });

  describe("link 메서드", () => {
    it("set_mode", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.set_mode(id, "agent");
      expect(tracker.get(id)!.mode).toBe("agent");
    });

    it("set_executor", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.set_executor(id, "claude_sdk");
      expect(tracker.get(id)!.executor_provider).toBe("claude_sdk");
    });

    it("link_loop", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.link_loop(id, "loop-1");
      expect(tracker.get(id)!.loop_id).toBe("loop-1");
    });

    it("link_task", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.link_task(id, "task-1");
      expect(tracker.get(id)!.task_id).toBe("task-1");
    });

    it("link_subagent — 중복 방지", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.link_subagent(id, "sub-1");
      tracker.link_subagent(id, "sub-1");
      tracker.link_subagent(id, "sub-2");
      expect(tracker.get(id)!.subagent_ids).toEqual(["sub-1", "sub-2"]);
    });

    it("link_workflow", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.link_workflow(id, "wf-1");
      expect(tracker.get(id)!.workflow_id).toBe("wf-1");
    });

    it("set_tool_count", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.set_tool_count(id, 5);
      expect(tracker.get(id)!.tool_calls_count).toBe(5);
    });

    it("없는 run_id에 link → 무시", () => {
      const tracker = new ProcessTracker();
      expect(() => tracker.set_mode("nonexistent", "task")).not.toThrow();
    });
  });

  describe("find_active_by_key", () => {
    it("provider + chat_id + alias로 검색", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params({ provider: "slack", chat_id: "ch2", alias: "bot" }));
      const found = tracker.find_active_by_key("slack" as "telegram", "ch2", "bot");
      expect(found).not.toBeNull();
      expect(found!.run_id).toBe(id);
    });

    it("없는 키 → null", () => {
      const tracker = new ProcessTracker();
      expect(tracker.find_active_by_key("slack" as "telegram", "nonexistent", "x")).toBeNull();
    });

    it("end 후 → null", () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      tracker.end(id, "completed");
      expect(tracker.find_active_by_key("telegram", "ch1", "default")).toBeNull();
    });
  });

  describe("list_active / list_recent", () => {
    it("list_active — active만 반환", () => {
      const tracker = new ProcessTracker();
      const id1 = tracker.start(make_params({ chat_id: "a" }));
      tracker.start(make_params({ chat_id: "b" }));
      tracker.end(id1, "completed");
      expect(tracker.list_active()).toHaveLength(1);
    });

    it("list_recent — 역순 반환", () => {
      const tracker = new ProcessTracker();
      const id1 = tracker.start(make_params({ chat_id: "a" }));
      const id2 = tracker.start(make_params({ chat_id: "b" }));
      tracker.end(id1, "completed");
      tracker.end(id2, "failed");
      const recent = tracker.list_recent();
      expect(recent).toHaveLength(2);
      expect(recent[0].run_id).toBe(id2); // 최신 먼저
    });

    it("list_recent limit", () => {
      const tracker = new ProcessTracker();
      for (let i = 0; i < 5; i++) {
        const id = tracker.start(make_params({ chat_id: `ch${i}` }));
        tracker.end(id, "completed");
      }
      expect(tracker.list_recent(2)).toHaveLength(2);
    });
  });

  describe("history 제한", () => {
    it("max_history 초과 시 오래된 항목 제거", () => {
      const tracker = new ProcessTracker({ max_history: 3 });
      for (let i = 0; i < 5; i++) {
        const id = tracker.start(make_params({ chat_id: `ch${i}` }));
        tracker.end(id, "completed");
      }
      expect(tracker.list_recent(10)).toHaveLength(3);
    });
  });

  describe("on_change 콜백", () => {
    it("start → on_change('start') 호출", () => {
      const changes: Array<{ type: string; entry: ProcessEntry }> = [];
      const tracker = new ProcessTracker({
        on_change: (type, entry) => changes.push({ type, entry }),
      });
      tracker.start(make_params());
      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("start");
    });

    it("end → on_change('end') 호출", () => {
      const changes: Array<{ type: string }> = [];
      const tracker = new ProcessTracker({
        on_change: (type) => changes.push({ type }),
      });
      const id = tracker.start(make_params());
      tracker.end(id, "completed");
      expect(changes).toHaveLength(2);
      expect(changes[1].type).toBe("end");
    });
  });

  describe("cancel", () => {
    it("cancel_strategy 없으면 실패", async () => {
      const tracker = new ProcessTracker();
      const id = tracker.start(make_params());
      const result = await tracker.cancel(id);
      expect(result.cancelled).toBe(false);
      expect(result.details).toContain("cancel_strategy");
    });

    it("없는 프로세스 cancel → 실패", async () => {
      const tracker = new ProcessTracker();
      const result = await tracker.cancel("nonexistent");
      expect(result.cancelled).toBe(false);
    });

    it("cascade cancel — subagent + loop + task + abort", async () => {
      const strategy: CancelStrategy = {
        abort_run: vi.fn(() => true),
        stop_loop: vi.fn(() => true),
        cancel_task: vi.fn(async () => true),
        cancel_subagent: vi.fn(() => true),
      };
      const tracker = new ProcessTracker({ cancel_strategy: strategy });
      const id = tracker.start(make_params());
      tracker.link_subagent(id, "sub-1");
      tracker.link_loop(id, "loop-1");
      tracker.link_task(id, "task-1");

      const result = await tracker.cancel(id);
      expect(result.cancelled).toBe(true);
      expect(result.details).toContain("sub-1");
      expect(result.details).toContain("loop-1");
      expect(result.details).toContain("task-1");
      expect(result.details).toContain("abort_signal");
      expect(strategy.cancel_subagent).toHaveBeenCalledWith("sub-1");
      expect(strategy.stop_loop).toHaveBeenCalledWith("loop-1");
      expect(strategy.cancel_task).toHaveBeenCalledWith("task-1");
    });

    it("cancel 후 상태는 cancelled", async () => {
      const strategy: CancelStrategy = {
        abort_run: vi.fn(() => true),
        stop_loop: vi.fn(() => true),
        cancel_task: vi.fn(async () => true),
        cancel_subagent: vi.fn(() => true),
      };
      const tracker = new ProcessTracker({ cancel_strategy: strategy });
      const id = tracker.start(make_params());
      await tracker.cancel(id);
      const entry = tracker.get(id);
      expect(entry!.status).toBe("cancelled");
      expect(entry!.error).toBe("cascade_cancel");
    });
  });
});
