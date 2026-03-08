import { describe, it, expect, vi } from "vitest";
import { spawn_agent_handler } from "../../../src/agent/nodes/spawn-agent.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

function make_node(overrides?: Partial<any>): OrcheNodeDefinition {
  return { node_id: "test-node", node_type: "spawn_agent", task: "do something", role: "assistant", ...overrides } as OrcheNodeDefinition;
}
function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}
function make_runner(spawn_agent?: any, wait_agent?: any) {
  return {
    state: { workflow_id: "wf-001", channel: "slack", chat_id: "C123", memory: {} },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() },
    services: spawn_agent ? { spawn_agent, wait_agent } : undefined,
  } as any;
}

describe("spawn_agent_handler metadata", () => {
  it("node_type = spawn_agent", () => { expect(spawn_agent_handler.node_type).toBe("spawn_agent"); });

  it("create_default: role=assistant, await=true, max_iterations=10", () => {
    const def = spawn_agent_handler.create_default?.();
    expect(def?.role).toBe("assistant");
    expect(def?.await_completion).toBe(true);
    expect(def?.max_iterations).toBe(10);
  });
});

describe("spawn_agent_handler.execute", () => {
  it("task 템플릿 보간 + _meta 반환", async () => {
    const node = make_node({ task: "analyze {{memory.topic}}" });
    const ctx = make_ctx({ topic: "revenue" });
    const result = await spawn_agent_handler.execute(node, ctx);
    expect(result.output._meta.task).toBe("analyze revenue");
    expect(result.output.status).toBe("pending");
  });

  it("task 없으면 경고", () => {
    const node = make_node({ task: "" });
    const result = spawn_agent_handler.test(node);
    expect(result.warnings).toContain("task is empty");
  });

  it("max_iterations > 50 → 경고", () => {
    const node = make_node({ max_iterations: 51 });
    const result = spawn_agent_handler.test(node);
    expect(result.warnings).toContain("max_iterations > 50 may be expensive");
  });

  it("test preview: role/model/await 포함", () => {
    const node = make_node({ task: "summarize", role: "analyst", model: "claude-opus-4-6", await_completion: false });
    const preview = spawn_agent_handler.test(node).preview;
    expect(preview.role).toBe("analyst");
    expect(preview.model).toBe("claude-opus-4-6");
    expect(preview.await).toBe(false);
  });
});

describe("spawn_agent_handler.runner_execute", () => {
  it("services.spawn_agent 없음 → execute 폴백 (_meta 반환)", async () => {
    const runner = make_runner(undefined);
    const result = await spawn_agent_handler.runner_execute!(make_node(), make_ctx(), runner);
    expect(result.output._meta).toBeDefined();
    expect(result.output.status).toBe("pending");
  });

  it("spawn 성공 + await_completion=false → agent_id + status (wait 미호출)", async () => {
    const spawn = vi.fn().mockResolvedValue({ agent_id: "agent-abc", status: "running" });
    const wait = vi.fn();
    const runner = make_runner(spawn, wait);
    const node = make_node({ await_completion: false });
    const result = await spawn_agent_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.agent_id).toBe("agent-abc");
    expect(result.output.status).toBe("running");
    expect(wait).not.toHaveBeenCalled();
  });

  it("spawn 성공 + await=true + wait 없음 → status 반환 (wait 미호출)", async () => {
    const spawn = vi.fn().mockResolvedValue({ agent_id: "agent-xyz", status: "running" });
    const runner = make_runner(spawn, undefined);
    const node = make_node({ await_completion: true });
    const result = await spawn_agent_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.agent_id).toBe("agent-xyz");
    expect(result.output.result).toBeNull();
  });

  it("spawn 성공 + await=true + wait 있음 → completion 반환", async () => {
    const spawn = vi.fn().mockResolvedValue({ agent_id: "agent-done", status: "running" });
    const wait = vi.fn().mockResolvedValue({ status: "completed", result: "final answer" });
    const runner = make_runner(spawn, wait);
    const node = make_node({ await_completion: true });
    const result = await spawn_agent_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.status).toBe("completed");
    expect(result.output.result).toBe("final answer");
  });

  it("spawn 에러 → failed + error 문자열 + logger.warn", async () => {
    const spawn = vi.fn().mockRejectedValue(new Error("spawn failed"));
    const runner = make_runner(spawn, undefined);
    const result = await spawn_agent_handler.runner_execute!(make_node(), make_ctx(), runner);
    expect(result.output.status).toBe("failed");
    expect(result.output.error).toContain("spawn failed");
    expect(runner.logger.warn).toHaveBeenCalledWith("spawn_agent_node_error", expect.any(Object));
  });

  it("task 템플릿 보간 후 spawn 호출", async () => {
    const spawn = vi.fn().mockResolvedValue({ agent_id: "a1", status: "running" });
    const runner = make_runner(spawn, undefined);
    const node = make_node({ task: "analyze {{memory.item}}", await_completion: false });
    await spawn_agent_handler.runner_execute!(node, make_ctx({ item: "logs" }), runner);
    expect(spawn.mock.calls[0][0].task).toBe("analyze logs");
  });

  it("parent_id가 workflow_id를 포함", async () => {
    const spawn = vi.fn().mockResolvedValue({ agent_id: "a1", status: "running" });
    const runner = make_runner(spawn, undefined);
    const node = make_node({ await_completion: false });
    await spawn_agent_handler.runner_execute!(node, make_ctx(), runner);
    expect(spawn.mock.calls[0][0].parent_id).toContain("wf-001");
  });
});
