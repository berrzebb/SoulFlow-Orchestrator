/**
 * kanban-rule-executor — 미커버 분기 (cov4):
 * - L70: add_label action — get_card 반환 null → early return
 * - L137: evaluate_rules throw → rule_evaluate_error 로그
 * - L158: matches_trigger false → continue (card_stale rule + moved action)
 */
import { describe, it, expect, vi } from "vitest";
import { register_kanban_rule_executor } from "@src/services/kanban-rule-executor.js";
import type { KanbanStoreLike, KanbanEvent, KanbanRule } from "@src/services/kanban-store.js";

function make_rule(overrides: Partial<KanbanRule> = {}): KanbanRule {
  return {
    rule_id: "rule-1",
    board_id: "board-1",
    trigger: "card_moved",
    condition: {},
    action_type: "add_label",
    action_params: { label: "auto" },
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function make_event(overrides: Partial<KanbanEvent["data"]> = {}): KanbanEvent {
  return {
    board_id: "board-1",
    data: {
      card_id: "card-1",
      action: "moved",
      detail: { to: "done", from: "todo" },
      ...overrides,
    } as KanbanEvent["data"],
  };
}

// ── L70: get_card null → add_label early return ──────────────────────────

describe("kanban-rule-executor — add_label get_card null (L70)", () => {
  it("get_card null 반환 → L70 early return, update_card 미호출", async () => {
    const update_card = vi.fn();
    const subscribe = vi.fn();
    let captured_listener: ((event: KanbanEvent) => void) | null = null;

    const mock_store = {
      get_rules_by_trigger: vi.fn().mockResolvedValue([make_rule({ action_type: "add_label", action_params: { label: "urgent" } })]),
      get_card: vi.fn().mockResolvedValue(null), // L70: null 반환
      update_card,
      subscribe: vi.fn().mockImplementation((_board_id, listener) => { captured_listener = listener; }),
      unsubscribe: vi.fn(),
    } as unknown as KanbanStoreLike;

    const executor = register_kanban_rule_executor(mock_store);
    executor.watch("board-1");

    // 이벤트 직접 발행
    expect(captured_listener).not.toBeNull();
    await captured_listener!(make_event());
    await new Promise((r) => setTimeout(r, 50));

    // get_card null → update_card 미호출
    expect(update_card).not.toHaveBeenCalled();
    executor.dispose();
  });
});

// ── L137: evaluate_rules throw → rule_evaluate_error 로그 ─────────────────

describe("kanban-rule-executor — evaluate_rules throw (L137)", () => {
  it("get_rules_by_trigger throw → listener catch → rule_evaluate_error 로그", async () => {
    let captured_listener: ((event: KanbanEvent) => void) | null = null;

    const mock_store = {
      get_rules_by_trigger: vi.fn().mockRejectedValue(new Error("db error")),
      subscribe: vi.fn().mockImplementation((_board_id, listener) => { captured_listener = listener; }),
      unsubscribe: vi.fn(),
    } as unknown as KanbanStoreLike;

    const executor = register_kanban_rule_executor(mock_store);
    executor.watch("board-1");

    expect(captured_listener).not.toBeNull();
    // listener 호출 → evaluate_rules → get_rules_by_trigger throw → catch (L137)
    captured_listener!(make_event());
    // 비동기 catch 실행 대기
    await new Promise((r) => setTimeout(r, 50));

    // 오류가 전파되지 않고 로그만 남겨짐 (테스트가 실패하지 않으면 성공)
    expect(mock_store.get_rules_by_trigger).toHaveBeenCalled();
    executor.dispose();
  });
});

// ── L158: matches_trigger false → continue ────────────────────────────────

describe("kanban-rule-executor — matches_trigger false (L158)", () => {
  it("card_stale rule + moved action → matches_trigger false → action 미실행", async () => {
    const execute_action_spy = vi.fn();
    let captured_listener: ((event: KanbanEvent) => void) | null = null;

    // card_stale 트리거 rule 반환 (TRIGGER_TO_ACTIONS["card_stale"] = [] → matches_trigger false)
    const mock_store = {
      get_rules_by_trigger: vi.fn().mockResolvedValue([
        make_rule({ trigger: "card_stale", action_type: "comment", action_params: { text: "stale" } }),
      ]),
      move_card: execute_action_spy,
      add_comment: execute_action_spy,
      update_card: execute_action_spy,
      get_card: vi.fn().mockResolvedValue({ card_id: "card-1", labels: [] }),
      subscribe: vi.fn().mockImplementation((_board_id, listener) => { captured_listener = listener; }),
      unsubscribe: vi.fn(),
    } as unknown as KanbanStoreLike;

    const executor = register_kanban_rule_executor(mock_store);
    executor.watch("board-1");

    expect(captured_listener).not.toBeNull();
    await captured_listener!(make_event({ action: "moved" }));
    await new Promise((r) => setTimeout(r, 50));

    // card_stale rule은 moved action에 매칭 안 됨 → L158 continue → execute_action_spy 미호출
    expect(execute_action_spy).not.toHaveBeenCalled();
    executor.dispose();
  });
});
