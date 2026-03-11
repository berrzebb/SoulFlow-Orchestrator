/**
 * kanban_trigger_handler.test() — 미커버 분기:
 * - L75: mode="poll" && !kanban_column_id → 경고 추가
 */
import { describe, it, expect } from "vitest";
import { kanban_trigger_handler } from "@src/agent/nodes/kanban-trigger.js";

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
