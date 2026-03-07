/**
 * workspace 전파 통합 테스트.
 *
 * run_phase_loop() → node handler → 재귀 실행 노드 경로 전체에서
 * options.workspace가 ctx.workspace로 정확히 전달되는지 검증.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { register_all_nodes } from "../../src/agent/nodes/index.js";
import { register_node, get_node_handler } from "../../src/agent/node-registry.js";
import type { RunnerContext, NodeHandler } from "../../src/agent/node-registry.js";
import { run_phase_loop } from "../../src/agent/phase-loop-runner.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult } from "../../src/agent/orche-node-executor.js";
import type { OrcheNodeDefinition } from "../../src/agent/workflow-node.types.js";
import type { PhaseLoopRunOptions } from "../../src/agent/phase-loop.types.js";

beforeAll(() => {
  register_all_nodes();
});

const TEST_WORKSPACE = "/fake/test/workspace";

// ── 헬퍼: workspace를 캡처하는 spy node handler ──

function create_workspace_spy(): { captured: (string | undefined)[]; handler: NodeHandler } {
  const captured: (string | undefined)[] = [];
  const handler: NodeHandler = {
    node_type: "workspace_spy",
    icon: "S",
    color: "#000",
    shape: "rect" as const,
    output_schema: [{ name: "result", type: "string", description: "ok" }],
    input_schema: [],
    create_default: () => ({}),
    async execute(_node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
      captured.push(ctx.workspace);
      return { output: { result: "ok" } };
    },
    test() { return { preview: {}, warnings: [] }; },
  };
  return { captured, handler };
}

// ── mock store / deps ──

function create_mock_store() {
  return {
    upsert: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    insert_message: vi.fn(),
  };
}

function create_mock_subagents() {
  return {
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sub_1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  };
}

function create_noop_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// ── P0-1: phase-loop-runner가 workspace를 node ctx에 전달 ──

describe("P0-1: phase-loop-runner workspace 전파", () => {
  it("options.workspace가 orche node의 ctx.workspace로 전달된다", async () => {
    const { captured, handler } = create_workspace_spy();
    // spy handler 등록
    register_node(handler);

    const options: PhaseLoopRunOptions = {
      workflow_id: "wf_ws_test",
      title: "workspace test",
      objective: "verify workspace",
      channel: "test",
      chat_id: "test_chat",
      workspace: TEST_WORKSPACE,
      phases: [],
      nodes: [
        { node_id: "spy_1", node_type: "workspace_spy", title: "spy" } as OrcheNodeDefinition,
      ],
    };

    await run_phase_loop(options, {
      subagents: create_mock_subagents() as any,
      store: create_mock_store() as any,
      logger: create_noop_logger() as any,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(TEST_WORKSPACE);
  });

  it("workspace가 다른 값이면 해당 값이 ctx.workspace에 전달된다", async () => {
    const { captured, handler } = create_workspace_spy();
    handler.node_type = "workspace_spy_2";
    register_node(handler);

    const ALT_WORKSPACE = "/alternative/workspace";
    const options: PhaseLoopRunOptions = {
      workflow_id: "wf_ws_test_2",
      title: "alt workspace",
      objective: "verify alt workspace",
      channel: "test",
      chat_id: "test_chat",
      workspace: ALT_WORKSPACE,
      phases: [],
      nodes: [
        { node_id: "spy_2", node_type: "workspace_spy_2", title: "spy" } as OrcheNodeDefinition,
      ],
    };

    await run_phase_loop(options, {
      subagents: create_mock_subagents() as any,
      store: create_mock_store() as any,
      logger: create_noop_logger() as any,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(ALT_WORKSPACE);
  });
});

// ── P0-3: 재귀 실행 노드가 workspace를 전달 ──

describe("P0-3: 재귀 실행 노드 workspace 전달", () => {
  it("batch node가 자식 노드에 workspace를 전달한다", async () => {
    const { captured, handler } = create_workspace_spy();
    handler.node_type = "ws_spy_batch";
    register_node(handler);

    const options: PhaseLoopRunOptions = {
      workflow_id: "wf_batch_ws",
      title: "batch ws",
      objective: "test",
      channel: "test",
      chat_id: "c",
      workspace: TEST_WORKSPACE,
      phases: [],
      initial_memory: { items: ["a", "b", "c"] },
      nodes: [
        {
          node_id: "batch_1", node_type: "batch", title: "batch",
          array_field: "items", concurrency: 2, body_node: "body_spy",
          on_item_error: "continue",
        } as unknown as OrcheNodeDefinition,
        {
          node_id: "body_spy", node_type: "ws_spy_batch", title: "body",
          depends_on: ["batch_1"],
        } as OrcheNodeDefinition,
      ],
    };

    await run_phase_loop(options, {
      subagents: create_mock_subagents() as any,
      store: create_mock_store() as any,
      logger: create_noop_logger() as any,
    });

    // batch가 3개 아이템을 body_spy로 실행 (3회) + depends_on 해결 후 독립 실행 (1회) = 4회
    // 핵심: 모든 실행에서 workspace가 유지되는지 확인
    expect(captured.length).toBeGreaterThanOrEqual(3);
    for (const ws of captured) {
      expect(ws).toBe(TEST_WORKSPACE);
    }
  });

  it("loop node가 자식 노드에 workspace를 전달한다", async () => {
    const { captured, handler } = create_workspace_spy();
    handler.node_type = "ws_spy_loop";
    register_node(handler);

    const options: PhaseLoopRunOptions = {
      workflow_id: "wf_loop_ws",
      title: "loop ws",
      objective: "test",
      channel: "test",
      chat_id: "c",
      workspace: TEST_WORKSPACE,
      phases: [],
      initial_memory: { loop_items: [1, 2] },
      nodes: [
        {
          node_id: "loop_1", node_type: "loop", title: "loop",
          array_field: "loop_items", body_nodes: ["loop_body"], max_iterations: 10,
        } as unknown as OrcheNodeDefinition,
        {
          node_id: "loop_body", node_type: "ws_spy_loop", title: "body",
          depends_on: ["loop_1"],
        } as OrcheNodeDefinition,
      ],
    };

    await run_phase_loop(options, {
      subagents: create_mock_subagents() as any,
      store: create_mock_store() as any,
      logger: create_noop_logger() as any,
    });

    // loop가 2개 아이템에 대해 body 실행 (2회) + 독립 실행 (1회) = 3회
    expect(captured.length).toBeGreaterThanOrEqual(2);
    for (const ws of captured) {
      expect(ws).toBe(TEST_WORKSPACE);
    }
  });

  it("retry node가 runner_execute에서 workspace를 전달한다", async () => {
    const captured: (string | undefined)[] = [];
    const retry_handler = get_node_handler("retry")!;

    const target_node: OrcheNodeDefinition = {
      node_id: "rt_target", node_type: "set", title: "target",
    } as OrcheNodeDefinition;

    const retry_node: OrcheNodeDefinition = {
      node_id: "rt_retry", node_type: "retry", title: "retry",
      target_node: "rt_target", max_attempts: 3,
      backoff: "fixed", initial_delay_ms: 1, max_delay_ms: 1,
    } as unknown as OrcheNodeDefinition;

    let exec_count = 0;
    const mock_runner: RunnerContext = {
      state: { workflow_id: "wf", title: "", objective: "", channel: "", chat_id: "", status: "running", current_phase: 0, phases: [], memory: {}, created_at: "", updated_at: "", orche_states: [{ node_id: "rt_target", node_type: "set", status: "pending" }] },
      options: { workflow_id: "wf", title: "", objective: "", channel: "", chat_id: "", phases: [], workspace: TEST_WORKSPACE },
      logger: create_noop_logger() as any,
      emit: vi.fn(),
      all_nodes: [target_node, retry_node],
      skipped_nodes: new Set(),
      execute_node: async (_node, ctx) => {
        captured.push(ctx.workspace);
        exec_count++;
        if (exec_count <= 1) throw new Error("retry me");
        return { output: { result: "ok" } };
      },
    };

    const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: TEST_WORKSPACE };
    await retry_handler.runner_execute!(retry_node, ctx, mock_runner);

    expect(captured.length).toBe(2);
    for (const ws of captured) {
      expect(ws).toBe(TEST_WORKSPACE);
    }
  });

  it("error-handler node가 runner_execute에서 try/fallback에 workspace를 전달한다", async () => {
    const captured: (string | undefined)[] = [];
    const eh_handler = get_node_handler("error_handler")!;

    const try_node: OrcheNodeDefinition = { node_id: "eh_try", node_type: "set", title: "try" } as OrcheNodeDefinition;
    const fb_node: OrcheNodeDefinition = { node_id: "eh_fb", node_type: "set", title: "fallback" } as OrcheNodeDefinition;
    const eh_node: OrcheNodeDefinition = {
      node_id: "eh_1", node_type: "error_handler", title: "eh",
      try_nodes: ["eh_try"], on_error: "fallback", fallback_nodes: ["eh_fb"],
    } as unknown as OrcheNodeDefinition;

    let call_idx = 0;
    const mock_runner: RunnerContext = {
      state: { workflow_id: "wf", title: "", objective: "", channel: "", chat_id: "", status: "running", current_phase: 0, phases: [], memory: {}, created_at: "", updated_at: "", orche_states: [{ node_id: "eh_try", node_type: "set", status: "pending" }] },
      options: { workflow_id: "wf", title: "", objective: "", channel: "", chat_id: "", phases: [], workspace: TEST_WORKSPACE },
      logger: create_noop_logger() as any,
      emit: vi.fn(),
      all_nodes: [try_node, fb_node, eh_node],
      skipped_nodes: new Set(),
      execute_node: async (_node, ctx) => {
        captured.push(ctx.workspace);
        call_idx++;
        if (call_idx === 1) throw new Error("try failed");
        return { output: { result: "recovered" } };
      },
    };

    const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: TEST_WORKSPACE };
    await eh_handler.runner_execute!(eh_node, ctx, mock_runner);

    // try (1회 fail) + fallback (1회 success) = 2회
    expect(captured.length).toBe(2);
    for (const ws of captured) {
      expect(ws).toBe(TEST_WORKSPACE);
    }
  });
});

// ── P0-5: DatabaseTool 경로 규약 ──

describe("P0-5: DatabaseTool 경로 규약", () => {
  it("DatabaseTool data_dir이 workspace/runtime/datasources를 사용한다", async () => {
    const { join } = await import("node:path");
    const { DatabaseTool } = await import("../../src/agent/tools/database.js");
    const ws = join("/my", "workspace");
    const tool = new DatabaseTool({ workspace: ws });
    const result = await tool.execute({ operation: "query", datasource: "testdb", sql: "SELECT 1" });
    // 존재하지 않는 DB이므로 에러 메시지에 경로 포함 (OS별 separator 고려)
    const expected_path = join(ws, "runtime", "datasources", "testdb.db");
    expect(result).toContain(expected_path);
    // 이전 버그: workspace/workspace/runtime 이중 중첩이 없어야 함
    expect(result).not.toContain(join("workspace", "workspace"));
  });
});
