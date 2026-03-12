import { describe, it, expect, vi } from "vitest";
import { kanban_trigger_handler } from "../../../src/agent/nodes/kanban-trigger.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("kanban_trigger_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "kanban_trigger",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be kanban_trigger", () => {
    expect(kanban_trigger_handler.node_type).toBe("kanban_trigger");
  });

  it("execute: should execute handler", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await kanban_trigger_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = kanban_trigger_handler.test(node);
    expect(result.preview).toBeDefined();
  });
});

// ── L75: poll mode + no column_id ─────────────────────────────────────────────

describe("kanban_trigger_handler.test — L75: poll mode 경고", () => {
  it("kanban_mode=poll, kanban_column_id 없음 → 경고 추가 (L75)", () => {
    const node = {
      node_id: "n1",
      node_type: "kanban_trigger",
      kanban_mode: "poll",
      kanban_board_id: "BOARD-1",
      kanban_column_id: "",   // 빈 값 → trim() = "" → truthy false
    } as any;
    const result = kanban_trigger_handler.test(node);
    expect(result.warnings.some((w: string) => w.includes("kanban_column_id"))).toBe(true);
  });

  it("kanban_mode=poll, kanban_column_id=공백 → 경고 (L75)", () => {
    const node = {
      node_id: "n2",
      node_type: "kanban_trigger",
      kanban_mode: "poll",
      kanban_board_id: "BOARD-2",
      kanban_column_id: "   ",  // 공백만
    } as any;
    const result = kanban_trigger_handler.test(node);
    expect(result.warnings.some((w: string) => w.includes("kanban_column_id"))).toBe(true);
  });
});

// ── from kanban-trigger-extended.test.ts ──

function make_kt_node(overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "kanban_trigger",
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_kt_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined } as any;
}

function make_kt_runner(wait_fn?: (board_id: string, opts: unknown) => Promise<unknown>): any {
  return {
    services: wait_fn ? { wait_kanban_event: wait_fn } : undefined,
    state: { memory: {} },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

describe("kanban_trigger_handler — create_default", () => {
  it("기본값 반환", () => {
    const defaults = kanban_trigger_handler.create_default!();
    expect((defaults as any).trigger_type).toBe("kanban_event");
    expect((defaults as any).kanban_board_id).toBe("");
    expect(Array.isArray((defaults as any).kanban_actions)).toBe(true);
  });
});

describe("kanban_trigger_handler — test()", () => {
  it("kanban_board_id 없음 → warning 포함", () => {
    const node = make_kt_node({ kanban_board_id: "", kanban_actions: ["created"] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toContain("kanban_board_id is required");
  });

  it("kanban_actions 없음 → warning 포함", () => {
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: [] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toContain("at least one kanban_actions filter recommended");
  });

  it("둘 다 있음 → warnings 없음", () => {
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 board_id/actions/column_id 포함", () => {
    const node = make_kt_node({ kanban_board_id: "B1", kanban_actions: ["moved"], kanban_column_id: "done" });
    const r = kanban_trigger_handler.test!(node);
    expect(r.preview).toMatchObject({ board_id: "B1", actions: ["moved"], column_id: "done" });
  });
});

describe("kanban_trigger_handler — runner_execute", () => {
  it("wait 없음 → execute() 대체 반환", async () => {
    const runner = make_kt_runner(undefined);
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output).toBeDefined();
    expect(r.output.action).toBe("created");
  });

  it("kanban_board_id 없음 → error 반환", async () => {
    const wait = vi.fn();
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output.error).toContain("kanban_board_id is required");
    expect(wait).not.toHaveBeenCalled();
  });

  it("주입된 이벤트(__pending_kanban_trigger_event) → 즉시 반환", async () => {
    const wait = vi.fn();
    const injected_event = { card_id: "SO-25", board_id: "BOARD-1", action: "moved", actor: "user", detail: {}, created_at: "2024-01-01" };
    const runner = {
      services: { wait_kanban_event: wait },
      state: { memory: { __pending_kanban_trigger_event: injected_event } },
      logger: { warn: vi.fn() },
    };
    const node = make_kt_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output).toEqual(injected_event);
    expect(wait).not.toHaveBeenCalled();
    expect(runner.state.memory.__pending_kanban_trigger_event).toBeUndefined();
  });

  it("wait → 이벤트 반환 → output에 포함", async () => {
    const event = { card_id: "SO-30", board_id: "BOARD-1", action: "created", actor: "alice", detail: {}, created_at: "2024-01-01" };
    const wait = vi.fn().mockResolvedValue(event);
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output).toEqual(event);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ actions: ["created"] }));
  });

  it("wait → null (waiting) → waiting: true 반환", async () => {
    const wait = vi.fn().mockResolvedValue(null);
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output.waiting).toBe(true);
    expect(r.output.board_id).toBe("BOARD-1");
  });

  it("wait → 예외 → error 포함", async () => {
    const wait = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(r.output.error).toContain("connection refused");
  });

  it("kanban_actions 없음 → actions: undefined 전달", async () => {
    const wait = vi.fn().mockResolvedValue({ card_id: "x", board_id: "BOARD-1", action: "", actor: "", detail: {}, created_at: "" });
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: [] });
    await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ actions: undefined }));
  });

  it("column_id 공백 → undefined 전달", async () => {
    const wait = vi.fn().mockResolvedValue({ card_id: "x", board_id: "BOARD-1", action: "", actor: "", detail: {}, created_at: "" });
    const runner = make_kt_runner(wait);
    const node = make_kt_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"], kanban_column_id: "   " });
    await kanban_trigger_handler.runner_execute!(node, make_kt_ctx(), runner);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ column_id: undefined }));
  });
});
