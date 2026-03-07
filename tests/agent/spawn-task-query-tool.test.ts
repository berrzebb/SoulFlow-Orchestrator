import { describe, it, expect, vi } from "vitest";
import { SpawnTool, type SpawnCallback, type SpawnRequest } from "@src/agent/tools/spawn.js";
import { TaskQueryTool, type TaskQueryCallback } from "@src/agent/tools/task-query.js";

describe("SpawnTool", () => {
  function make_tool(cb?: SpawnCallback) {
    const callback: SpawnCallback = cb ?? vi.fn(async () => ({
      subagent_id: "sub_1",
      status: "running",
    }));
    return new SpawnTool(callback);
  }

  it("spawns a subagent with minimal params", async () => {
    const callback = vi.fn(async (req: SpawnRequest) => ({
      subagent_id: "sub_1",
      status: "running",
    }));
    const tool = new SpawnTool(callback);
    const result = await tool.execute({ task: "do something" });
    const parsed = JSON.parse(result);
    expect(parsed.subagent_id).toBe("sub_1");
    expect(parsed.status).toBe("running");
    expect(callback).toHaveBeenCalledOnce();
    const req = callback.mock.calls[0][0];
    expect(req.task).toBe("do something");
  });

  it("passes optional fields", async () => {
    const callback = vi.fn(async () => ({ subagent_id: "sub_2", status: "running" }));
    const tool = new SpawnTool(callback);
    await tool.execute({
      task: "my task",
      label: "label1",
      role: "lead",
      soul: "friendly",
      heart: "warm",
      model: "gpt-4",
      max_turns: 50,
    });
    const req = callback.mock.calls[0][0];
    expect(req.label).toBe("label1");
    expect(req.role).toBe("lead");
    expect(req.soul).toBe("friendly");
    expect(req.heart).toBe("warm");
    expect(req.model).toBe("gpt-4");
    expect(req.max_turns).toBe(50);
  });

  it("uses per-call context for origin channel/chat", async () => {
    const callback = vi.fn(async () => ({ subagent_id: "sub_3", status: "running" }));
    const tool = new SpawnTool(callback);
    await tool.execute({ task: "test" }, { channel: "slack", chat_id: "C999" });
    const req = callback.mock.calls[0][0];
    expect(req.origin_channel).toBe("slack");
    expect(req.origin_chat_id).toBe("C999");
  });

  it("returns cancelled when signal aborted", async () => {
    const tool = make_tool();
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute({ task: "test" }, { signal: controller.signal });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("cancelled");
  });

  it("has correct metadata", () => {
    const tool = make_tool();
    expect(tool.name).toBe("spawn");
    expect(tool.category).toBe("spawn");
  });
});

describe("TaskQueryTool", () => {
  it("queries a task by ID", async () => {
    const callback: TaskQueryCallback = vi.fn(async (id) => ({
      task_id: id,
      status: "running",
      current_turn: 5,
      max_turns: 100,
    }));
    const tool = new TaskQueryTool(callback);
    const result = await tool.execute({ task_id: "task_42" });
    const parsed = JSON.parse(result);
    expect(parsed.task_id).toBe("task_42");
    expect(parsed.status).toBe("running");
    expect(parsed.current_turn).toBe(5);
  });

  it("returns not_found when callback returns null", async () => {
    const callback: TaskQueryCallback = vi.fn(async () => null);
    const tool = new TaskQueryTool(callback);
    const result = await tool.execute({ task_id: "nonexistent" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe("not_found");
    expect(parsed.task_id).toBe("nonexistent");
  });

  it("returns error when task_id is missing", async () => {
    const callback: TaskQueryCallback = vi.fn(async () => null);
    const tool = new TaskQueryTool(callback);
    const result = await tool.execute({});
    expect(result).toBe("Error: task_id is required");
  });

  it("trims whitespace from task_id", async () => {
    const callback: TaskQueryCallback = vi.fn(async () => null);
    const tool = new TaskQueryTool(callback);
    const result = await tool.execute({ task_id: "   " });
    expect(result).toBe("Error: task_id is required");
  });

  it("has correct metadata", () => {
    const callback: TaskQueryCallback = vi.fn(async () => null);
    const tool = new TaskQueryTool(callback);
    expect(tool.name).toBe("task_query");
    expect(tool.category).toBe("admin");
  });
});
