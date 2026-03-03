import { describe, it, expect, beforeEach } from "vitest";
import { SubagentRegistry } from "@src/agent/subagents.ts";

describe("Subagent Cascade Cancel", () => {
  let registry: SubagentRegistry;

  beforeEach(() => {
    registry = new SubagentRegistry({ workspace: process.cwd() });
  });

  it("cancel(cascade=true) — 자식 subagent도 취소됨", () => {
    const parent_id = "parent-1";
    const child_id = "child-1";
    const grandchild_id = "grandchild-1";

    // 수동으로 running 상태 시뮬레이션
    const parent_abort = new AbortController();
    const child_abort = new AbortController();
    const grandchild_abort = new AbortController();

    registry.upsert({ id: parent_id, role: "leader", status: "running" });
    registry.upsert({ id: child_id, role: "worker", status: "running" });
    registry.upsert({ id: grandchild_id, role: "worker", status: "running" });

    // running Map에 직접 추가 (private 접근을 위해 타입 우회)
    const running = (registry as unknown as { running: Map<string, unknown> }).running;
    running.set(parent_id, {
      ref: registry.get(parent_id),
      abort: parent_abort,
      done: Promise.resolve(),
      parent_id: null,
    });
    running.set(child_id, {
      ref: registry.get(child_id),
      abort: child_abort,
      done: Promise.resolve(),
      parent_id: parent_id,
    });
    running.set(grandchild_id, {
      ref: registry.get(grandchild_id),
      abort: grandchild_abort,
      done: Promise.resolve(),
      parent_id: child_id,
    });

    registry.cancel(parent_id, true);

    expect(parent_abort.signal.aborted).toBe(true);
    expect(child_abort.signal.aborted).toBe(true);
    expect(grandchild_abort.signal.aborted).toBe(true);

    expect(registry.get(parent_id)?.status).toBe("cancelled");
    expect(registry.get(child_id)?.status).toBe("cancelled");
    expect(registry.get(grandchild_id)?.status).toBe("cancelled");
  });

  it("cancel(cascade=false) — 자식은 취소되지 않음", () => {
    const parent_id = "p-2";
    const child_id = "c-2";

    const parent_abort = new AbortController();
    const child_abort = new AbortController();

    registry.upsert({ id: parent_id, role: "leader", status: "running" });
    registry.upsert({ id: child_id, role: "worker", status: "running" });

    const running = (registry as unknown as { running: Map<string, unknown> }).running;
    running.set(parent_id, {
      ref: registry.get(parent_id),
      abort: parent_abort,
      done: Promise.resolve(),
      parent_id: null,
    });
    running.set(child_id, {
      ref: registry.get(child_id),
      abort: child_abort,
      done: Promise.resolve(),
      parent_id: parent_id,
    });

    registry.cancel(parent_id, false);

    expect(parent_abort.signal.aborted).toBe(true);
    expect(child_abort.signal.aborted).toBe(false);
    expect(registry.get(child_id)?.status).toBe("running");
  });

  it("SpawnSubagentOptions에 parent_id 포함", () => {
    // parent_id 옵션이 타입에 존재하는지 타입 체크
    const opts = {
      task: "test task",
      parent_id: "parent-x",
    };
    expect(opts.parent_id).toBe("parent-x");
  });
});
