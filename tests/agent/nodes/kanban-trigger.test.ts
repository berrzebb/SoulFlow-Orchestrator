import { describe, it, expect } from "vitest";
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
