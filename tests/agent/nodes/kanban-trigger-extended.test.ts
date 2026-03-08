/**
 * kanban_trigger_handler — runner_execute / test / create_default 미커버 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { kanban_trigger_handler } from "@src/agent/nodes/kanban-trigger.js";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

// ── 헬퍼 ────────────────────────────────────────

function make_node(overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return {
    node_id: "n1",
    node_type: "kanban_trigger",
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined } as any;
}

function make_runner(wait_fn?: (board_id: string, opts: unknown) => Promise<unknown>): any {
  return {
    services: wait_fn ? { wait_kanban_event: wait_fn } : undefined,
    state: { memory: {} },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
}

// ══════════════════════════════════════════
// create_default
// ══════════════════════════════════════════

describe("kanban_trigger_handler — create_default", () => {
  it("기본값 반환", () => {
    const defaults = kanban_trigger_handler.create_default!();
    expect((defaults as any).trigger_type).toBe("kanban_event");
    expect((defaults as any).kanban_board_id).toBe("");
    expect(Array.isArray((defaults as any).kanban_actions)).toBe(true);
  });
});

// ══════════════════════════════════════════
// test — warnings
// ══════════════════════════════════════════

describe("kanban_trigger_handler — test()", () => {
  it("kanban_board_id 없음 → warning 포함", () => {
    const node = make_node({ kanban_board_id: "", kanban_actions: ["created"] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toContain("kanban_board_id is required");
  });

  it("kanban_actions 없음 → warning 포함", () => {
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: [] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toContain("at least one kanban_actions filter recommended");
  });

  it("둘 다 있음 → warnings 없음", () => {
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = kanban_trigger_handler.test!(node);
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 board_id/actions/column_id 포함", () => {
    const node = make_node({ kanban_board_id: "B1", kanban_actions: ["moved"], kanban_column_id: "done" });
    const r = kanban_trigger_handler.test!(node);
    expect(r.preview).toMatchObject({ board_id: "B1", actions: ["moved"], column_id: "done" });
  });
});

// ══════════════════════════════════════════
// runner_execute
// ══════════════════════════════════════════

describe("kanban_trigger_handler — runner_execute", () => {
  it("wait 없음 → execute() 대체 반환", async () => {
    const runner = make_runner(undefined);
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(r.output).toBeDefined();
    expect(r.output.action).toBe("created"); // execute() 반환
  });

  it("kanban_board_id 없음 → error 반환", async () => {
    const wait = vi.fn();
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
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
    const node = make_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(r.output).toEqual(injected_event);
    expect(wait).not.toHaveBeenCalled();
    // __pending_kanban_trigger 관련 키 삭제됨
    expect(runner.state.memory.__pending_kanban_trigger_event).toBeUndefined();
  });

  it("wait → 이벤트 반환 → output에 포함", async () => {
    const event = { card_id: "SO-30", board_id: "BOARD-1", action: "created", actor: "alice", detail: {}, created_at: "2024-01-01" };
    const wait = vi.fn().mockResolvedValue(event);
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"] });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(r.output).toEqual(event);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ actions: ["created"] }));
  });

  it("wait → null (waiting) → waiting: true 반환", async () => {
    const wait = vi.fn().mockResolvedValue(null);
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(r.output.waiting).toBe(true);
    expect(r.output.board_id).toBe("BOARD-1");
  });

  it("wait → 예외 → error 포함", async () => {
    const wait = vi.fn().mockRejectedValue(new Error("connection refused"));
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "BOARD-1" });
    const r = await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(r.output.error).toContain("connection refused");
  });

  it("kanban_actions 없음 → actions: undefined 전달", async () => {
    const wait = vi.fn().mockResolvedValue({ card_id: "x", board_id: "BOARD-1", action: "", actor: "", detail: {}, created_at: "" });
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: [] });
    await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ actions: undefined }));
  });

  it("column_id 공백 → undefined 전달", async () => {
    const wait = vi.fn().mockResolvedValue({ card_id: "x", board_id: "BOARD-1", action: "", actor: "", detail: {}, created_at: "" });
    const runner = make_runner(wait);
    const node = make_node({ kanban_board_id: "BOARD-1", kanban_actions: ["created"], kanban_column_id: "   " });
    await kanban_trigger_handler.runner_execute!(node, make_ctx(), runner);
    expect(wait).toHaveBeenCalledWith("BOARD-1", expect.objectContaining({ column_id: undefined }));
  });
});
