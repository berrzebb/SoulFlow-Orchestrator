/**
 * KanbanTool — 미커버 분기 (cov4):
 * - L153: create_board — scope_type/scope_id 누락
 * - L172: update_board — columns 파라미터 포함
 * - L229: update_card — card_id 누락
 * - L241: update_card — store.update_card null 반환 (not found)
 * - L247: archive_card — card_id 누락
 * - L316: board_summary — board_id 누락
 * - L318: board_summary — store.board_summary null 반환 (not found)
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";

function make_store(overrides: Record<string, unknown> = {}) {
  return {
    list_boards: vi.fn().mockResolvedValue([]),
    create_board: vi.fn().mockResolvedValue({ board_id: "B1", prefix: "KB", name: "보드", columns: [] }),
    update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "업데이트" }),
    create_card: vi.fn().mockResolvedValue({ card_id: "KB-1", title: "카드", column_id: "todo" }),
    list_cards: vi.fn().mockResolvedValue([]),
    get_card: vi.fn().mockResolvedValue(null),
    move_card: vi.fn().mockResolvedValue(null),
    update_card: vi.fn().mockResolvedValue(null),  // null = not found
    delete_card: vi.fn().mockResolvedValue(false),
    add_comment: vi.fn().mockResolvedValue(undefined),
    list_comments: vi.fn().mockResolvedValue([]),
    add_relation: vi.fn().mockResolvedValue({ relation_id: "R1" }),
    remove_relation: vi.fn().mockResolvedValue(false),
    list_relations: vi.fn().mockResolvedValue([]),
    get_subtasks: vi.fn().mockResolvedValue([]),
    list_activities: vi.fn().mockResolvedValue([]),
    add_rule: vi.fn().mockResolvedValue({ rule_id: "R1", trigger: "card_moved", action_type: "comment", condition: {}, action_params: {}, board_id: "B1", enabled: true }),
    list_rules: vi.fn().mockResolvedValue([]),
    remove_rule: vi.fn().mockResolvedValue(false),
    update_rule: vi.fn().mockResolvedValue(null),
    board_summary: vi.fn().mockResolvedValue(null),  // null = not found
    get_board_metrics: vi.fn().mockResolvedValue(null),
    get_card_time_tracking: vi.fn().mockResolvedValue(null),
    search_cards: vi.fn().mockResolvedValue([]),
    create_template: vi.fn().mockResolvedValue({ template_id: "T1", name: "템플릿", cards: [] }),
    list_templates: vi.fn().mockResolvedValue([]),
    get_template: vi.fn().mockResolvedValue(null),
    delete_template: vi.fn().mockResolvedValue(false),
    save_filter: vi.fn().mockResolvedValue({ filter_id: "F1", name: "필터", criteria: {} }),
    list_filters: vi.fn().mockResolvedValue([]),
    delete_filter: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as any;
}

function make_tool(overrides: Record<string, unknown> = {}) {
  return new KanbanTool(make_store(overrides));
}

// ── L153: create_board — scope_type/scope_id 누락 ─────────────────────────────

describe("KanbanTool — L153: create_board scope 누락", () => {
  it("name은 있지만 scope_type 없음 → L153 에러 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "create_board", name: "보드명", scope_id: "ch1" });
    expect(r).toContain("scope_type and scope_id are required");
  });

  it("name은 있지만 scope_id 없음 → L153 에러 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "create_board", name: "보드명", scope_type: "channel" });
    expect(r).toContain("scope_type and scope_id are required");
  });
});

// ── L172: update_board — columns 파라미터 ─────────────────────────────────────

describe("KanbanTool — L172: update_board columns 파라미터 포함", () => {
  it("columns 파라미터 전달 → L172: updates.columns 설정", async () => {
    const store = make_store({ update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "업데이트" }) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "update_board",
      board_id: "B1",
      columns: [{ id: "todo", name: "할 일" }],
    });
    expect(r).toContain("B1");
    // update_board가 columns를 포함한 updates 객체로 호출됐는지 확인
    const call_args = vi.mocked(store.update_board).mock.calls[0];
    expect(call_args[1]).toHaveProperty("columns");
  });
});

// ── L229: update_card — card_id 누락 ──────────────────────────────────────────

describe("KanbanTool — L229: update_card card_id 누락", () => {
  it("card_id 없음 → L229 에러 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "update_card" });
    expect(r).toContain("card_id is required");
  });
});

// ── L241: update_card — store null 반환 (not found) ──────────────────────────

describe("KanbanTool — L241: update_card store null 반환", () => {
  it("store.update_card null → L241 에러 반환", async () => {
    const tool = make_tool({ update_card: vi.fn().mockResolvedValue(null) });
    const r = await tool.execute({ action: "update_card", card_id: "KB-999" });
    expect(r).toContain("card not found");
    expect(r).toContain("KB-999");
  });
});

// ── L247: archive_card — card_id 누락 ─────────────────────────────────────────

describe("KanbanTool — L247: archive_card card_id 누락", () => {
  it("card_id 없음 → L247 에러 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "archive_card" });
    expect(r).toContain("card_id is required");
  });
});

// ── L316: board_summary — board_id 누락 ───────────────────────────────────────

describe("KanbanTool — L316: board_summary board_id 누락", () => {
  it("board_id 없음 → L316 에러 반환", async () => {
    const tool = make_tool();
    const r = await tool.execute({ action: "board_summary" });
    expect(r).toContain("board_id is required");
  });
});

// ── L318: board_summary — store null 반환 (not found) ─────────────────────────

describe("KanbanTool — L318: board_summary store null 반환", () => {
  it("store.board_summary null → L318 에러 반환", async () => {
    const tool = make_tool({ board_summary: vi.fn().mockResolvedValue(null) });
    const r = await tool.execute({ action: "board_summary", board_id: "nonexistent" });
    expect(r).toContain("board not found");
    expect(r).toContain("nonexistent");
  });
});
