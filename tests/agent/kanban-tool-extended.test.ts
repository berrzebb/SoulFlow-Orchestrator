/**
 * KanbanTool 확장 커버리지 — 미테스트 액션: list_activities, rules, templates, metrics, search, filters
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";
import type { KanbanStoreLike } from "@src/services/kanban-store.js";

function make_store(): KanbanStoreLike {
  return {
    create_board: vi.fn(),
    list_boards: vi.fn().mockResolvedValue([]),
    get_board: vi.fn().mockResolvedValue(null),
    board_summary: vi.fn().mockResolvedValue(null),
    create_card: vi.fn(),
    get_card: vi.fn().mockResolvedValue(null),
    update_card: vi.fn().mockResolvedValue(null),
    move_card: vi.fn().mockResolvedValue(null),
    delete_card: vi.fn().mockResolvedValue(false),
    list_cards: vi.fn().mockResolvedValue([]),
    add_comment: vi.fn().mockResolvedValue({}),
    list_comments: vi.fn().mockResolvedValue([]),
    add_relation: vi.fn(),
    remove_relation: vi.fn().mockResolvedValue(false),
    list_relations: vi.fn().mockResolvedValue([]),
    get_subtasks: vi.fn().mockResolvedValue([]),
    list_activities: vi.fn().mockResolvedValue([]),
    add_rule: vi.fn(),
    list_rules: vi.fn().mockResolvedValue([]),
    remove_rule: vi.fn().mockResolvedValue(false),
    update_rule: vi.fn().mockResolvedValue(null),
    create_template: vi.fn(),
    list_templates: vi.fn().mockResolvedValue([]),
    get_template: vi.fn().mockResolvedValue(null),
    delete_template: vi.fn().mockResolvedValue(false),
    get_board_metrics: vi.fn().mockResolvedValue(null),
    get_card_time_tracking: vi.fn().mockResolvedValue(null),
    search_cards: vi.fn().mockResolvedValue([]),
    save_filter: vi.fn(),
    list_filters: vi.fn().mockResolvedValue([]),
    delete_filter: vi.fn().mockResolvedValue(false),
  } as unknown as KanbanStoreLike;
}

describe("KanbanTool — list_activities", () => {
  it("card_id와 board_id 모두 없음 → Error 반환", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_activities" });
    expect(r).toContain("Error");
    expect(r).toContain("card_id or board_id");
  });

  it("활동 없음 → 활동 없음 반환", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_activities", board_id: "KB-1" });
    expect(r).toContain("활동 없음");
  });

  it("활동 있음 → 목록 반환", async () => {
    const store = make_store();
    (store.list_activities as ReturnType<typeof vi.fn>).mockResolvedValue([
      { created_at: "2026-01-01T00:00:00Z", actor: "agent", action: "moved", card_id: "KB-1", detail: { to: "done" } },
    ]);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_activities", board_id: "KB-1" });
    expect(r).toContain("agent");
    expect(r).toContain("KB-1");
  });
});

describe("KanbanTool — add_rule", () => {
  it("board_id 없음 → Error 반환", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "add_rule", trigger: "card_moved", action_type: "comment" });
    expect(r).toContain("Error");
    expect(r).toContain("board_id");
  });

  it("규칙 생성 성공", async () => {
    const store = make_store();
    (store.add_rule as ReturnType<typeof vi.fn>).mockResolvedValue({
      rule_id: "rule-1", board_id: "KB-1", trigger: "card_moved", action_type: "comment",
      condition: {}, action_params: {}, enabled: true,
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "add_rule", board_id: "KB-1",
      trigger: "card_moved", action_type: "comment",
    });
    expect(r).toContain("rule created");
    expect(r).toContain("rule-1");
  });

  it("rule_executor 있을 때 watch() 호출", async () => {
    const store = make_store();
    (store.add_rule as ReturnType<typeof vi.fn>).mockResolvedValue({
      rule_id: "r1", board_id: "KB-1", trigger: "card_moved", action_type: "assign",
      condition: {}, action_params: {}, enabled: true,
    });
    const tool = new KanbanTool(store);
    const mock_watch = vi.fn();
    tool.set_rule_executor({ watch: mock_watch } as unknown as import("@src/services/kanban-rule-executor.js").KanbanRuleExecutor);
    await tool.execute({ action: "add_rule", board_id: "KB-1", trigger: "card_moved", action_type: "assign" });
    expect(mock_watch).toHaveBeenCalledWith("KB-1");
  });
});

describe("KanbanTool — list_rules", () => {
  it("board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_rules" });
    expect(r).toContain("Error");
  });

  it("규칙 없음 → 규칙 없음", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_rules", board_id: "KB-1" });
    expect(r).toContain("규칙 없음");
  });

  it("규칙 있음 → 목록 반환", async () => {
    const store = make_store();
    (store.list_rules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { rule_id: "r1", trigger: "card_moved", action_type: "comment", enabled: true, condition: {} },
    ]);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_rules", board_id: "KB-1" });
    expect(r).toContain("r1");
    expect(r).toContain("card_moved");
  });
});

describe("KanbanTool — remove_rule", () => {
  it("rule_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "remove_rule" });
    expect(r).toContain("Error");
  });

  it("없는 rule → Error 반환", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "remove_rule", rule_id: "r-ghost" });
    expect(r).toContain("Error");
  });

  it("삭제 성공", async () => {
    const store = make_store();
    (store.remove_rule as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "remove_rule", rule_id: "r1" });
    expect(r).toContain("rule removed");
  });
});

describe("KanbanTool — toggle_rule", () => {
  it("rule_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "toggle_rule" });
    expect(r).toContain("Error");
  });

  it("없는 rule → Error 반환", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "toggle_rule", rule_id: "ghost" });
    expect(r).toContain("Error");
  });

  it("활성화 성공", async () => {
    const store = make_store();
    (store.update_rule as ReturnType<typeof vi.fn>).mockResolvedValue({ rule_id: "r1", board_id: "KB-1", enabled: true });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: true });
    expect(r).toContain("enabled");
  });
});

describe("KanbanTool — create_template", () => {
  it("name 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_template", cards: [{ title: "Card 1" }] });
    expect(r).toContain("Error");
    expect(r).toContain("name");
  });

  it("cards 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_template", name: "My Template" });
    expect(r).toContain("Error");
    expect(r).toContain("cards");
  });

  it("템플릿 생성 성공", async () => {
    const store = make_store();
    (store.create_template as ReturnType<typeof vi.fn>).mockResolvedValue({
      template_id: "tmpl-1", name: "Sprint Template", cards: [{ title: "Task 1" }], columns: [],
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "create_template",
      name: "Sprint Template",
      cards: [{ title: "Task 1" }],
    });
    expect(r).toContain("template created");
    expect(r).toContain("tmpl-1");
  });
});

describe("KanbanTool — list_templates", () => {
  it("빈 목록 → 템플릿 없음", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_templates" });
    expect(r).toContain("템플릿 없음");
  });

  it("템플릿 있음 → 목록 반환", async () => {
    const store = make_store();
    (store.list_templates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { template_id: "t1", name: "Sprint", cards: [{ title: "c1" }, { title: "c2" }], columns: [] },
    ]);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_templates" });
    expect(r).toContain("Sprint");
    expect(r).toContain("2 cards");
  });
});

describe("KanbanTool — create_board_from_template", () => {
  it("template_name 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_board_from_template", scope_type: "channel", scope_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("template_name");
  });

  it("template 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({
      action: "create_board_from_template",
      template_name: "ghost-template",
      scope_type: "channel",
      scope_id: "C1",
    });
    expect(r).toContain("Error");
    expect(r).toContain("template not found");
  });

  it("template으로 보드 생성 성공", async () => {
    const store = make_store();
    (store.get_template as ReturnType<typeof vi.fn>).mockResolvedValue({
      template_id: "t1", name: "Sprint",
      cards: [{ title: "Task A", column_id: "todo" }],
      columns: [{ id: "todo", name: "To Do", color: "#fff" }],
    });
    (store.create_board as ReturnType<typeof vi.fn>).mockResolvedValue({
      board_id: "KB-10", prefix: "KB", name: "Sprint",
      columns: [{ id: "todo", name: "To Do", color: "#fff" }],
    });
    (store.create_card as ReturnType<typeof vi.fn>).mockResolvedValue({ card_id: "KB-1", title: "Task A", column_id: "todo" });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "create_board_from_template",
      template_name: "Sprint",
      scope_type: "channel",
      scope_id: "C1",
    });
    expect(r).toContain("KB-10");
    expect(r).toContain("1 cards");
  });
});

describe("KanbanTool — delete_template", () => {
  it("template_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_template" });
    expect(r).toContain("Error");
  });

  it("없는 template → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_template", template_id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("template not found");
  });

  it("삭제 성공", async () => {
    const store = make_store();
    (store.delete_template as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "delete_template", template_id: "t1" });
    expect(r).toContain("template deleted");
  });
});

describe("KanbanTool — board_metrics", () => {
  it("board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "board_metrics" });
    expect(r).toContain("Error");
    expect(r).toContain("board_id");
  });

  it("보드 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "board_metrics", board_id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("board not found");
  });

  it("메트릭스 반환", async () => {
    const store = make_store();
    (store.get_board_metrics as ReturnType<typeof vi.fn>).mockResolvedValue({
      throughput: 5,
      avg_cycle_time_hours: 24,
      cards_by_column: { todo: 2, done: 5 },
      cards_by_priority: { high: 3, low: 4 },
      velocity: [{ week: "2026-W01", done: 3 }],
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "board_metrics", board_id: "KB-1", days: 7 });
    expect(r).toContain("throughput: 5");
    expect(r).toContain("velocity");
  });
});

describe("KanbanTool — card_time_tracking", () => {
  it("card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "card_time_tracking" });
    expect(r).toContain("Error");
  });

  it("카드 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "card_time_tracking", card_id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("card not found");
  });

  it("시간 추적 반환", async () => {
    const store = make_store();
    (store.get_card_time_tracking as ReturnType<typeof vi.fn>).mockResolvedValue({
      total_hours: 8,
      column_times: [
        { column_id: "todo", duration_hours: 2, exited_at: "2026-01-01" },
        { column_id: "in_progress", duration_hours: 6, exited_at: null },
      ],
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "card_time_tracking", card_id: "KB-1" });
    expect(r).toContain("8h");
    expect(r).toContain("in_progress");
    expect(r).toContain("← current");
  });
});

describe("KanbanTool — search", () => {
  it("query 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "search" });
    expect(r).toContain("Error");
    expect(r).toContain("query");
  });

  it("결과 없음 → 검색 결과 없음", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "search", query: "no match here" });
    expect(r).toContain("검색 결과 없음");
  });

  it("결과 반환", async () => {
    const store = make_store();
    (store.search_cards as ReturnType<typeof vi.fn>).mockResolvedValue([
      { card_id: "KB-1", title: "Fix bug", board_name: "Main", column_id: "in_progress", priority: "high" },
    ]);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "search", query: "bug" });
    expect(r).toContain("KB-1");
    expect(r).toContain("Fix bug");
  });
});

describe("KanbanTool — save_filter / list_filters / delete_filter", () => {
  it("save_filter: board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "save_filter", name: "my filter" });
    expect(r).toContain("Error");
    expect(r).toContain("board_id");
  });

  it("save_filter 성공", async () => {
    const store = make_store();
    (store.save_filter as ReturnType<typeof vi.fn>).mockResolvedValue({
      filter_id: "f1", name: "Urgent", criteria: { priority: "urgent" }, board_id: "KB-1",
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "save_filter", board_id: "KB-1", name: "Urgent", criteria: { priority: "urgent" } });
    expect(r).toContain("filter saved");
    expect(r).toContain("f1");
  });

  it("list_filters: board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_filters" });
    expect(r).toContain("Error");
  });

  it("list_filters: 빈 목록 → 필터 없음", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_filters", board_id: "KB-1" });
    expect(r).toContain("필터 없음");
  });

  it("list_filters: 필터 목록 반환", async () => {
    const store = make_store();
    (store.list_filters as ReturnType<typeof vi.fn>).mockResolvedValue([
      { filter_id: "f1", name: "Urgent", criteria: { priority: "urgent" } },
    ]);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_filters", board_id: "KB-1" });
    expect(r).toContain("f1");
    expect(r).toContain("Urgent");
  });

  it("delete_filter: filter_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_filter" });
    expect(r).toContain("Error");
    expect(r).toContain("filter_id");
  });

  it("delete_filter: 없는 필터 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_filter", filter_id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("filter not found");
  });

  it("delete_filter 성공", async () => {
    const store = make_store();
    (store.delete_filter as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "delete_filter", filter_id: "f1" });
    expect(r).toContain("filter deleted");
  });
});
