import { describe, it, expect, vi } from "vitest";
import { sub_workflow_handler } from "../../../src/agent/nodes/sub-workflow.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

function make_node(overrides?: Partial<any>): OrcheNodeDefinition {
  return { node_id: "test-node", node_type: "sub_workflow", workflow_name: "my-workflow", ...overrides } as OrcheNodeDefinition;
}
function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}
function make_runner(run_sub_workflow?: any) {
  return {
    state: { workflow_id: "wf-001", memory: {} },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() },
    emit: vi.fn(),
    run_sub_workflow,
  } as any;
}

describe("sub_workflow_handler", () => {
  it("node_type = sub_workflow", () => { expect(sub_workflow_handler.node_type).toBe("sub_workflow"); });

  it("create_default: workflow_name 빈 문자열", () => {
    expect(sub_workflow_handler.create_default?.().workflow_name).toBe("");
  });

  it("execute: _meta에 workflow_name 포함", async () => {
    const result = await sub_workflow_handler.execute(make_node({ workflow_name: "report-gen" }), make_ctx());
    expect(result.output._meta.workflow_name).toBe("report-gen");
    expect(result.output.result).toBeNull();
  });

  it("execute: input_mapping 없으면 undefined", async () => {
    const result = await sub_workflow_handler.execute(make_node(), make_ctx());
    expect(result.output._meta.input_mapping).toBeUndefined();
  });

  it("execute: input_mapping 있으면 resolve_deep 적용", async () => {
    const node = make_node({ input_mapping: { user: "{{memory.actor}}" } });
    const result = await sub_workflow_handler.execute(node, make_ctx({ actor: "alice" }));
    expect(result.output._meta.input_mapping?.user).toBe("alice");
  });

  it("test: workflow_name 없으면 경고", () => {
    expect(sub_workflow_handler.test(make_node({ workflow_name: "" })).warnings).toContain("workflow_name is required");
  });

  it("test: 유효한 workflow_name → 경고 없음", () => {
    expect(sub_workflow_handler.test(make_node({ workflow_name: "valid" })).warnings).toEqual([]);
  });
});

describe("sub_workflow_handler.runner_execute", () => {
  it("run_sub_workflow 없음 → error 반환", async () => {
    const result = await sub_workflow_handler.runner_execute!(make_node(), make_ctx(), make_runner(undefined));
    expect(result.output.error).toContain("not available");
  });

  it("workflow_name 없음 → error 반환", async () => {
    const result = await sub_workflow_handler.runner_execute!(make_node({ workflow_name: "" }), make_ctx(), make_runner(vi.fn()));
    expect(result.output.error).toContain("workflow_name is required");
  });

  it("성공적 실행 → result + phases 반환 + node_started emit", async () => {
    const run_sub_workflow = vi.fn().mockResolvedValue({ result: { ok: true }, phases: ["phase1"] });
    const runner = make_runner(run_sub_workflow);
    const result = await sub_workflow_handler.runner_execute!(make_node({ workflow_name: "my-wf" }), make_ctx(), runner);
    expect(result.output.result).toEqual({ ok: true });
    expect(result.output.phases).toEqual(["phase1"]);
    expect(runner.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "node_started", node_type: "sub_workflow" }));
  });

  it("실행 중 에러 → error 문자열 + logger.warn", async () => {
    const run_sub_workflow = vi.fn().mockRejectedValue(new Error("network failure"));
    const runner = make_runner(run_sub_workflow);
    const result = await sub_workflow_handler.runner_execute!(make_node({ workflow_name: "fail-wf" }), make_ctx(), runner);
    expect(result.output.error).toContain("network failure");
    expect(runner.logger.warn).toHaveBeenCalledWith("sub_workflow_error", expect.any(Object));
  });

  it("타임아웃 (timeout_ms=10) → timed out 에러", async () => {
    const run_sub_workflow = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 2000)));
    const runner = make_runner(run_sub_workflow);
    const result = await sub_workflow_handler.runner_execute!(make_node({ workflow_name: "slow-wf", timeout_ms: 10 }), make_ctx(), runner);
    expect(result.output.error).toContain("timed out");
  });

  it("input_mapping 보간 후 run_sub_workflow 호출", async () => {
    const run_sub_workflow = vi.fn().mockResolvedValue({ result: null, phases: [] });
    const runner = make_runner(run_sub_workflow);
    await sub_workflow_handler.runner_execute!(
      make_node({ workflow_name: "my-wf", input_mapping: { key: "{{memory.val}}" } }),
      make_ctx({ val: "injected" }),
      runner,
    );
    expect(run_sub_workflow).toHaveBeenCalledWith("my-wf", { key: "injected" });
  });
});
