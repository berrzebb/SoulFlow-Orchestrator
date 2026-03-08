/**
 * error_handler_handler — runner_execute 미커버 경로 보충.
 * try_nodes 성공, 에러 → continue/fallback, run_fallback 성공/에러, orche_states 업데이트.
 */
import { describe, it, expect, vi } from "vitest";
import { error_handler_handler } from "../../../src/agent/nodes/error-handler.js";
import type { ErrorHandlerNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { RunnerContext } from "../../../src/agent/node-registry.js";

function make_node(overrides: Partial<ErrorHandlerNodeDefinition> = {}): OrcheNodeDefinition {
  return {
    node_id: "eh-1",
    node_type: "error_handler",
    try_nodes: [],
    on_error: "continue",
    ...overrides,
  } as unknown as OrcheNodeDefinition;
}

function make_runner(opts: {
  all_nodes?: OrcheNodeDefinition[];
  execute_node?: (node: OrcheNodeDefinition, ctx: any) => Promise<any>;
  orche_states?: Array<{ node_id: string; status: string; result?: unknown }>;
} = {}): RunnerContext {
  const { all_nodes = [], execute_node = vi.fn().mockResolvedValue({ output: { ok: true } }) } = opts;
  return {
    state: {
      workflow_id: "wf-1",
      memory: {} as any,
      orche_states: opts.orche_states,
    } as any,
    options: { abort_signal: undefined, workspace: "/tmp" } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    emit: vi.fn(),
    all_nodes,
    skipped_nodes: new Set(),
    execute_node,
  };
}

const MOCK_CTX = { memory: {}, workspace: "/tmp", abort_signal: undefined };

// ══════════════════════════════════════════
// runner_execute — try_nodes 성공
// ══════════════════════════════════════════

describe("error_handler_handler.runner_execute — try_nodes 성공", () => {
  it("try_nodes 없음 → has_error=false, output=null", async () => {
    const node = make_node({ try_nodes: [] });
    const runner = make_runner();
    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);
    expect(result.output).toMatchObject({ has_error: false, error: "", error_node: "" });
  });

  it("try_node 실행 성공 → memory 업데이트 + orche_state status=completed", async () => {
    const target: OrcheNodeDefinition = { node_id: "child-1", node_type: "noop" } as any;
    const exec = vi.fn().mockResolvedValue({ output: { value: 42 } });
    const orche_states = [{ node_id: "child-1", status: "pending" }];
    const runner = make_runner({ all_nodes: [target], execute_node: exec, orche_states });

    const node = make_node({ try_nodes: ["child-1"] });
    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);

    expect(exec).toHaveBeenCalledOnce();
    expect(runner.state.memory["child-1"]).toEqual({ value: 42 });
    expect(orche_states[0].status).toBe("completed");
    expect(result.output).toMatchObject({ has_error: false });
  });

  it("try_node ID 없음 → skip (continue)됨", async () => {
    const runner = make_runner({ all_nodes: [] });
    const node = make_node({ try_nodes: ["nonexistent"] });
    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);
    expect(result.output).toMatchObject({ has_error: false });
  });
});

// ══════════════════════════════════════════
// runner_execute — 에러 → on_error=continue
// ══════════════════════════════════════════

describe("error_handler_handler.runner_execute — on_error=continue", () => {
  it("try_node 에러 + on_error=continue → has_error=true, runner.emit 호출", async () => {
    const target: OrcheNodeDefinition = { node_id: "err-node", node_type: "noop" } as any;
    const exec = vi.fn().mockRejectedValue(new Error("network timeout"));
    const runner = make_runner({ all_nodes: [target], execute_node: exec });

    const node = make_node({ try_nodes: ["err-node"], on_error: "continue" });
    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);

    expect(runner.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "node_error" }));
    expect(result.output).toMatchObject({
      has_error: true,
      error: "network timeout",
      error_node: "err-node",
    });
  });
});

// ══════════════════════════════════════════
// runner_execute — 에러 → on_error=fallback
// ══════════════════════════════════════════

describe("error_handler_handler.runner_execute — on_error=fallback", () => {
  it("fallback_nodes 성공 → has_error=true, error=원본 에러, output=fallback 출력", async () => {
    const try_node: OrcheNodeDefinition = { node_id: "try-1", node_type: "noop" } as any;
    const fb_node: OrcheNodeDefinition = { node_id: "fb-1", node_type: "noop" } as any;

    const exec = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error("primary failed")))
      .mockImplementationOnce(() => Promise.resolve({ output: { fallback: "result" } }));

    const runner = make_runner({ all_nodes: [try_node, fb_node], execute_node: exec });
    const node = make_node({
      try_nodes: ["try-1"],
      on_error: "fallback",
      fallback_nodes: ["fb-1"],
    } as any);

    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);
    expect(result.output).toMatchObject({
      has_error: true,
      error: "primary failed",
      error_node: "try-1",
      output: { fallback: "result" },
    });
    expect(runner.state.memory["fb-1"]).toEqual({ fallback: "result" });
  });

  it("fallback_node 에러 → 에러 정보 반환", async () => {
    const try_node: OrcheNodeDefinition = { node_id: "try-1", node_type: "noop" } as any;
    const fb_node: OrcheNodeDefinition = { node_id: "fb-err", node_type: "noop" } as any;

    const exec = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error("primary error")))
      .mockImplementationOnce(() => Promise.reject(new Error("fallback also failed")));

    const runner = make_runner({ all_nodes: [try_node, fb_node], execute_node: exec });
    const node = make_node({
      try_nodes: ["try-1"],
      on_error: "fallback",
      fallback_nodes: ["fb-err"],
    } as any);

    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);
    expect(result.output).toMatchObject({
      has_error: true,
      error_node: "fb-err",
    });
    expect(String(result.output?.error || "")).toContain("fallback");
  });

  it("fallback_node ID 없음 → skip됨 (is_orche_node 실패)", async () => {
    const try_node: OrcheNodeDefinition = { node_id: "try-1", node_type: "noop" } as any;
    const exec = vi.fn().mockRejectedValue(new Error("err"));
    const runner = make_runner({ all_nodes: [try_node], execute_node: exec });

    const node = make_node({
      try_nodes: ["try-1"],
      on_error: "fallback",
      fallback_nodes: ["nonexistent-fb"],
    } as any);

    const result = await error_handler_handler.runner_execute!(node, MOCK_CTX as any, runner);
    // fallback_nodes에 없는 ID → 루프 skip → fallback_output=null
    expect(result.output).toMatchObject({ has_error: true, error: "err" });
  });
});

// ══════════════════════════════════════════
// test() — warnings 경로
// ══════════════════════════════════════════

describe("error_handler_handler.test — warnings", () => {
  it("try_nodes 없음 → warning 포함", () => {
    const node = make_node({ try_nodes: [] });
    const result = error_handler_handler.test(node, {} as any);
    expect(result.warnings?.some((w: string) => w.includes("try_nodes"))).toBe(true);
  });

  it("on_error=fallback + fallback_nodes 없음 → warning 포함", () => {
    const node = make_node({ try_nodes: ["n1"], on_error: "fallback", fallback_nodes: [] } as any);
    const result = error_handler_handler.test(node, {} as any);
    expect(result.warnings?.some((w: string) => w.includes("fallback"))).toBe(true);
  });

  it("create_default → try_nodes/on_error 기본값", () => {
    const defaults = error_handler_handler.create_default!();
    expect(defaults).toMatchObject({ try_nodes: [], on_error: "continue" });
  });
});
