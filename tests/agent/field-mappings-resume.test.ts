/**
 * D0-2: resume 후에도 field_mappings가 적용되는지 검증.
 *
 * - 첫 실행에서 definition에 field_mappings가 저장되는지
 * - field_mappings가 노드 간 데이터를 올바르게 매핑하는지
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { register_all_nodes } from "../../src/agent/nodes/index.js";
import { register_node } from "../../src/agent/node-registry.js";
import type { NodeHandler } from "../../src/agent/node-registry.js";
import { run_phase_loop } from "../../src/agent/phase-loop-runner.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult } from "../../src/agent/orche-node-executor.js";
import type { OrcheNodeDefinition } from "../../src/agent/workflow-node.types.js";
import type { PhaseLoopState } from "../../src/agent/phase-loop.types.js";

/** 실행 시마다 캡처 대상을 외부에서 제어할 수 있는 공유 상태. */
let emitter_value: Record<string, unknown> = {};
const receiver_captures: Record<string, unknown>[] = [];

beforeAll(() => {
  register_all_nodes();

  const emitter_handler: NodeHandler = {
    node_type: "fm_emitter",
    icon: "E", color: "#000", shape: "rect" as const,
    output_schema: [{ name: "data", type: "object", description: "emitted" }],
    input_schema: [],
    create_default: () => ({}),
    async execute(): Promise<OrcheNodeExecuteResult> {
      return { output: { ...emitter_value } };
    },
    test() { return { preview: {}, warnings: [] }; },
  };

  const receiver_handler: NodeHandler = {
    node_type: "fm_receiver",
    icon: "R", color: "#000", shape: "rect" as const,
    output_schema: [{ name: "ok", type: "boolean", description: "ok" }],
    input_schema: [],
    create_default: () => ({}),
    async execute(_node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
      receiver_captures.push(JSON.parse(JSON.stringify(ctx.memory)));
      return { output: { ok: true } };
    },
    test() { return { preview: {}, warnings: [] }; },
  };

  register_node(emitter_handler);
  register_node(receiver_handler);
});

function create_mock_store() {
  const states = new Map<string, PhaseLoopState>();
  return {
    upsert: vi.fn(async (s: PhaseLoopState) => { states.set(s.workflow_id, JSON.parse(JSON.stringify(s))); }),
    get: vi.fn(async (id: string) => states.get(id) ?? null),
    list: vi.fn(async () => [...states.values()]),
    insert_message: vi.fn(),
    _states: states,
  };
}

function noop_logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mock_subagents() {
  return {
    spawn: vi.fn().mockResolvedValue({ subagent_id: "sub_1" }),
    wait_for_completion: vi.fn().mockResolvedValue({ status: "completed", content: "done" }),
    stop: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  };
}

describe("D0-2: field_mappings resume 보존", () => {
  it("definition에 field_mappings가 저장된다", async () => {
    emitter_value = { name: "Alice", score: 42 };
    const store = create_mock_store();
    const mappings = [
      { from_node: "emitter", from_field: "name", to_node: "receiver", to_field: "input_name" },
    ];

    await run_phase_loop({
      workflow_id: "wf_fm_def",
      title: "FM def test",
      objective: "test",
      channel: "test",
      chat_id: "test",
      phases: [],
      nodes: [
        { node_id: "emitter", node_type: "fm_emitter", title: "emit" } as OrcheNodeDefinition,
        { node_id: "receiver", node_type: "fm_receiver", title: "recv", depends_on: ["emitter"] } as OrcheNodeDefinition,
      ],
      field_mappings: mappings,
    }, {
      subagents: mock_subagents() as any,
      store: store as any,
      logger: noop_logger() as any,
    });

    const saved = store._states.get("wf_fm_def");
    expect(saved).toBeDefined();
    expect(saved!.definition?.field_mappings).toEqual(mappings);
  });

  it("field_mappings가 노드 간 데이터를 올바르게 매핑한다", async () => {
    emitter_value = { name: "Bob", score: 99 };
    receiver_captures.length = 0;
    const store = create_mock_store();
    const mappings = [
      { from_node: "src", from_field: "name", to_node: "dst", to_field: "mapped_name" },
      { from_node: "src", from_field: "score", to_node: "dst", to_field: "mapped_score" },
    ];

    await run_phase_loop({
      workflow_id: "wf_fm_map",
      title: "FM mapping test",
      objective: "test",
      channel: "test",
      chat_id: "test",
      phases: [],
      nodes: [
        { node_id: "src", node_type: "fm_emitter", title: "source" } as OrcheNodeDefinition,
        { node_id: "dst", node_type: "fm_receiver", title: "dest", depends_on: ["src"] } as OrcheNodeDefinition,
      ],
      field_mappings: mappings,
    }, {
      subagents: mock_subagents() as any,
      store: store as any,
      logger: noop_logger() as any,
    });

    expect(receiver_captures.length).toBeGreaterThanOrEqual(1);
    const mem = receiver_captures[0]!;
    const dst_input = mem["dst"] as Record<string, unknown>;
    expect(dst_input).toBeDefined();
    expect(dst_input.mapped_name).toBe("Bob");
    expect(dst_input.mapped_score).toBe(99);
  });
});
