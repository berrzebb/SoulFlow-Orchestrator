/**
 * KanbanTool — 미커버 핸들러 추가 보충.
 * list_cards / list_comments / comment / create_card (중복/필수 누락) /
 * move_card not found / get_card not found / toggle_rule / create_template /
 * list_templates / create_board_from_template / delete_template /
 * search / save_filter / list_filters / delete_filter / list_rules / remove_rule / unknown action
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";

function make_store(overrides: Record<string, unknown> = {}) {
  return {
    list_boards: vi.fn().mockResolvedValue([]),
    create_board: vi.fn().mockResolvedValue({ board_id: "B1", prefix: "KB", name: "보드", columns: [{ id: "todo" }] }),
    update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "업데이트" }),
    create_card: vi.fn().mockResolvedValue({ card_id: "KB-1", title: "카드", column_id: "todo" }),
    list_cards: vi.fn().mockResolvedValue([]),
    get_card: vi.fn().mockResolvedValue(null),
    move_card: vi.fn().mockResolvedValue(null),
    update_card: vi.fn().mockResolvedValue({ card_id: "KB-1" }),
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
    board_summary: vi.fn().mockResolvedValue(null),
    get_board_metrics: vi.fn().mockResolvedValue(null),
    get_card_time_tracking: vi.fn().mockResolvedValue(null),
    search_cards: vi.fn().mockResolvedValue([]),
    create_template: vi.fn().mockResolvedValue({ template_id: "T1", name: "기본 템플릿", cards: [] }),
    list_templates: vi.fn().mockResolvedValue([]),
    get_template: vi.fn().mockResolvedValue(null),
    delete_template: vi.fn().mockResolvedValue(false),
    save_filter: vi.fn().mockResolvedValue({ filter_id: "F1", name: "내 필터", criteria: {} }),
    list_filters: vi.fn().mockResolvedValue([]),
    delete_filter: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as any;
}

// ══════════════════════════════════════════
// list_cards — 빈 결과 / 결과 있음
// ══════════════════════════════════════════

describe("KanbanTool — list_cards", () => {
  it("board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_cards", board_id: "" });
    expect(r).toContain("board_id is required");
  });

  it("카드 없음 → '카드 없음'", async () => {
    const tool = new KanbanTool(make_store({ list_cards: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "list_cards", board_id: "B1" });
    expect(r).toBe("카드 없음");
  });

  it("카드 있음 → 목록 출력 (priority/assignee/comment 포함)", async () => {
    const store = make_store({
      list_cards: vi.fn().mockResolvedValue([
        { card_id: "KB-1", title: "태스크", column_id: "todo", priority: "high", assignee: "alice", comment_count: 3 },
        { card_id: "KB-2", title: "태스크2", column_id: "done", priority: "none", assignee: null, comment_count: 0 },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_cards", board_id: "B1" });
    expect(r).toContain("KB-1");
    expect(r).toContain("P:high");
    expect(r).toContain("→alice");
    expect(r).toContain("💬3");
    // priority:none은 P: 없음
    expect(r).not.toContain("P:none");
  });
});

// ══════════════════════════════════════════
// list_comments — 빈 / 있음
// ══════════════════════════════════════════

describe("KanbanTool — list_comments", () => {
  it("card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_comments", card_id: "" });
    expect(r).toContain("card_id is required");
  });

  it("코멘트 없음 → '코멘트 없음'", async () => {
    const tool = new KanbanTool(make_store({ list_comments: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "list_comments", card_id: "KB-1" });
    expect(r).toBe("코멘트 없음");
  });

  it("코멘트 있음 → 목록 포맷", async () => {
    const store = make_store({
      list_comments: vi.fn().mockResolvedValue([
        { comment_id: "C1", author: "alice", text: "LGTM", created_at: "2026-03-08T10:00:00Z" },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_comments", card_id: "KB-1" });
    expect(r).toContain("[alice");
    expect(r).toContain("LGTM");
  });
});

// ══════════════════════════════════════════
// comment — 필수 필드 누락
// ══════════════════════════════════════════

describe("KanbanTool — comment", () => {
  it("card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "comment", card_id: "", text: "메모" });
    expect(r).toContain("card_id and text are required");
  });

  it("text 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "comment", card_id: "KB-1", text: "" });
    expect(r).toContain("card_id and text are required");
  });

  it("코멘트 추가 성공", async () => {
    const tool = new KanbanTool(make_store({ add_comment: vi.fn().mockResolvedValue(undefined) }));
    const r = await tool.execute({ action: "comment", card_id: "KB-1", text: "잘 됩니다" });
    expect(r).toContain("comment added to KB-1");
  });
});

// ══════════════════════════════════════════
// create_card — 중복 카드 / 부모 있음
// ══════════════════════════════════════════

describe("KanbanTool — create_card 분기", () => {
  it("board_id / title 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_card", board_id: "", title: "" });
    expect(r).toContain("board_id and title are required");
  });

  it("동일 제목 카드 이미 있음 → already exists 반환", async () => {
    const store = make_store({
      list_cards: vi.fn().mockResolvedValue([
        { card_id: "KB-1", title: "기존 카드", column_id: "todo" },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "create_card", board_id: "B1", title: "기존 카드" });
    expect(r).toContain("already exists");
  });

  it("parent_id 있음 → child of 표시", async () => {
    const store = make_store({
      list_cards: vi.fn().mockResolvedValue([]),
      create_card: vi.fn().mockResolvedValue({ card_id: "KB-2", title: "서브태스크", column_id: "todo" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "create_card", board_id: "B1", title: "서브태스크", parent_id: "KB-1" });
    expect(r).toContain("child of KB-1");
  });
});

// ══════════════════════════════════════════
// move_card — not found 분기
// ══════════════════════════════════════════

describe("KanbanTool — move_card not found", () => {
  it("필수 필드 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "move_card", card_id: "", column_id: "" });
    expect(r).toContain("card_id and column_id are required");
  });

  it("card 없음 → Error: card not found", async () => {
    const tool = new KanbanTool(make_store({ move_card: vi.fn().mockResolvedValue(null) }));
    const r = await tool.execute({ action: "move_card", card_id: "KB-999", column_id: "done" });
    expect(r).toContain("card not found");
  });

  it("이동 성공", async () => {
    const store = make_store({ move_card: vi.fn().mockResolvedValue({ card_id: "KB-1" }) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "move_card", card_id: "KB-1", column_id: "done" });
    expect(r).toContain("KB-1 moved to done");
  });
});

// ══════════════════════════════════════════
// get_card — not found / 성공 (labels/description/metadata/subtask/relation/comment)
// ══════════════════════════════════════════

describe("KanbanTool — get_card", () => {
  it("card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "get_card", card_id: "" });
    expect(r).toContain("card_id is required");
  });

  it("없는 카드 → Error: card not found", async () => {
    const tool = new KanbanTool(make_store({ get_card: vi.fn().mockResolvedValue(null) }));
    const r = await tool.execute({ action: "get_card", card_id: "KB-999" });
    expect(r).toContain("card not found");
  });

  it("카드 있음 (labels/description/metadata/subtask/relation/comment)", async () => {
    const store = make_store({
      get_card: vi.fn().mockResolvedValue({
        card_id: "KB-1", title: "완료 태스크", column_id: "done",
        priority: "high", assignee: "alice", created_by: "agent", created_at: "2026-03-08",
        labels: ["bug", "p1"], description: "중요한 버그", metadata: { pr: "123" },
      }),
      list_relations: vi.fn().mockResolvedValue([
        { relation_id: "R1", type: "related_to", source_card_id: "KB-1", target_card_id: "KB-2" },
      ]),
      get_subtasks: vi.fn().mockResolvedValue([
        { card_id: "KB-3", title: "서브", column_id: "done" },
      ]),
      list_comments: vi.fn().mockResolvedValue([
        { comment_id: "C1", author: "bob", text: "확인" },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    expect(r).toContain("KB-1: 완료 태스크");
    expect(r).toContain("labels: bug");
    expect(r).toContain("중요한 버그");
    expect(r).toContain("subtasks");
    expect(r).toContain("related_to");
    expect(r).toContain("[bob]");
  });
});

// ══════════════════════════════════════════
// toggle_rule — rule found / not found
// ══════════════════════════════════════════

describe("KanbanTool — toggle_rule", () => {
  it("rule_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "toggle_rule", rule_id: "" });
    expect(r).toContain("rule_id is required");
  });

  it("rule 없음 → Error: rule not found", async () => {
    const tool = new KanbanTool(make_store({ update_rule: vi.fn().mockResolvedValue(null) }));
    const r = await tool.execute({ action: "toggle_rule", rule_id: "R999" });
    expect(r).toContain("rule not found");
  });

  it("rule enabled → 'enabled'", async () => {
    const store = make_store({
      update_rule: vi.fn().mockResolvedValue({ rule_id: "R1", enabled: true, board_id: "B1" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "toggle_rule", rule_id: "R1", enabled: true });
    expect(r).toContain("enabled");
  });

  it("rule disabled → 'disabled'", async () => {
    const store = make_store({
      update_rule: vi.fn().mockResolvedValue({ rule_id: "R1", enabled: false, board_id: "B1" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "toggle_rule", rule_id: "R1", enabled: false });
    expect(r).toContain("disabled");
  });
});

// ══════════════════════════════════════════
// list_rules / remove_rule
// ══════════════════════════════════════════

describe("KanbanTool — list_rules / remove_rule", () => {
  it("list_rules: board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_rules", board_id: "" });
    expect(r).toContain("board_id is required");
  });

  it("list_rules: 규칙 없음 → '규칙 없음'", async () => {
    const tool = new KanbanTool(make_store({ list_rules: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "list_rules", board_id: "B1" });
    expect(r).toBe("규칙 없음");
  });

  it("list_rules: 규칙 있음 → 목록 포맷", async () => {
    const store = make_store({
      list_rules: vi.fn().mockResolvedValue([
        { rule_id: "R1", trigger: "card_moved", action_type: "comment", enabled: true, condition: { to_column: "done" } },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_rules", board_id: "B1" });
    expect(r).toContain("R1");
    expect(r).toContain("card_moved");
  });

  it("remove_rule: rule_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "remove_rule", rule_id: "" });
    expect(r).toContain("rule_id is required");
  });

  it("remove_rule: 없는 rule → Error: rule not found", async () => {
    const tool = new KanbanTool(make_store({ remove_rule: vi.fn().mockResolvedValue(false) }));
    const r = await tool.execute({ action: "remove_rule", rule_id: "R999" });
    expect(r).toContain("rule not found");
  });

  it("remove_rule: 성공 → 'rule removed'", async () => {
    const tool = new KanbanTool(make_store({ remove_rule: vi.fn().mockResolvedValue(true) }));
    const r = await tool.execute({ action: "remove_rule", rule_id: "R1" });
    expect(r).toBe("rule removed");
  });
});

// ══════════════════════════════════════════
// create_template / list_templates / create_board_from_template / delete_template
// ══════════════════════════════════════════

describe("KanbanTool — template 액션", () => {
  it("create_template: name 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_template", name: "" });
    expect(r).toContain("name is required");
  });

  it("create_template: cards 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_template", name: "내 템플릿", cards: [] });
    expect(r).toContain("cards array is required");
  });

  it("create_template: 성공", async () => {
    const store = make_store({
      create_template: vi.fn().mockResolvedValue({ template_id: "T1", name: "내 템플릿", cards: [{ title: "카드1" }] }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "create_template",
      name: "내 템플릿",
      cards: [{ title: "카드1" }],
    });
    expect(r).toContain("T1");
    expect(r).toContain("1 cards");
  });

  it("list_templates: 없음 → '템플릿 없음'", async () => {
    const tool = new KanbanTool(make_store({ list_templates: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "list_templates" });
    expect(r).toBe("템플릿 없음");
  });

  it("list_templates: 있음 → 목록", async () => {
    const store = make_store({
      list_templates: vi.fn().mockResolvedValue([
        { template_id: "T1", name: "기본", cards: [{ title: "c1" }, { title: "c2" }] },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_templates" });
    expect(r).toContain("T1");
    expect(r).toContain("2 cards");
  });

  it("create_board_from_template: template_name 없음 → Error", async () => {
    const tool = new KanbanTool(make_store({ get_template: vi.fn().mockResolvedValue(null) }));
    const r = await tool.execute({ action: "create_board_from_template", template_name: "", scope_type: "channel", scope_id: "ch1" });
    expect(r).toContain("template_name or template_id is required");
  });

  it("create_board_from_template: scope 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "create_board_from_template", template_name: "템플릿", scope_type: "", scope_id: "" });
    expect(r).toContain("scope_type and scope_id are required");
  });

  it("create_board_from_template: template 없음 → Error", async () => {
    const store = make_store({ get_template: vi.fn().mockResolvedValue(null) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "create_board_from_template", template_name: "없음", scope_type: "channel", scope_id: "ch1" });
    expect(r).toContain("template not found");
  });

  it("create_board_from_template: 성공 (cards 포함)", async () => {
    const store = make_store({
      get_template: vi.fn().mockResolvedValue({
        template_id: "T1", name: "애자일", columns: undefined,
        cards: [{ title: "스프린트 계획", column_id: "todo" }],
      }),
      create_board: vi.fn().mockResolvedValue({ board_id: "B2", prefix: "AG", name: "애자일", columns: [{ id: "todo" }] }),
      create_card: vi.fn().mockResolvedValue({ card_id: "AG-1", title: "스프린트 계획", column_id: "todo" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({
      action: "create_board_from_template",
      template_name: "애자일",
      scope_type: "channel",
      scope_id: "ch1",
    });
    expect(r).toContain("B2");
    expect(r).toContain("1 cards");
  });

  it("delete_template: template_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_template", template_id: "" });
    expect(r).toContain("template_id is required");
  });

  it("delete_template: 없음 → Error", async () => {
    const tool = new KanbanTool(make_store({ delete_template: vi.fn().mockResolvedValue(false) }));
    const r = await tool.execute({ action: "delete_template", template_id: "T999" });
    expect(r).toContain("template not found");
  });

  it("delete_template: 성공", async () => {
    const tool = new KanbanTool(make_store({ delete_template: vi.fn().mockResolvedValue(true) }));
    const r = await tool.execute({ action: "delete_template", template_id: "T1" });
    expect(r).toBe("template deleted");
  });
});

// ══════════════════════════════════════════
// search
// ══════════════════════════════════════════

describe("KanbanTool — search", () => {
  it("query 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "search", query: "" });
    expect(r).toContain("query is required");
  });

  it("검색 결과 없음 → '검색 결과 없음'", async () => {
    const tool = new KanbanTool(make_store({ search_cards: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "search", query: "없는키워드" });
    expect(r).toContain("검색 결과 없음");
  });

  it("검색 결과 있음 → 목록 포맷", async () => {
    const store = make_store({
      search_cards: vi.fn().mockResolvedValue([
        { card_id: "KB-1", title: "버그 수정", board_name: "내 보드", column_id: "in_progress", priority: "high" },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "search", query: "버그" });
    expect(r).toContain("KB-1");
    expect(r).toContain("버그 수정");
    expect(r).toContain("P:high");
  });
});

// ══════════════════════════════════════════
// save_filter / list_filters / delete_filter
// ══════════════════════════════════════════

describe("KanbanTool — filter 액션", () => {
  it("save_filter: board_id/name 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "save_filter", board_id: "", name: "" });
    expect(r).toContain("board_id and name are required");
  });

  it("save_filter: 성공", async () => {
    const store = make_store({
      save_filter: vi.fn().mockResolvedValue({ filter_id: "F1", name: "급한 작업", criteria: {} }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "save_filter", board_id: "B1", name: "급한 작업", criteria: { priority: "urgent" } });
    expect(r).toContain("F1");
    expect(r).toContain("급한 작업");
  });

  it("list_filters: board_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "list_filters", board_id: "" });
    expect(r).toContain("board_id is required");
  });

  it("list_filters: 필터 없음 → '필터 없음'", async () => {
    const tool = new KanbanTool(make_store({ list_filters: vi.fn().mockResolvedValue([]) }));
    const r = await tool.execute({ action: "list_filters", board_id: "B1" });
    expect(r).toBe("필터 없음");
  });

  it("list_filters: 필터 있음 → 목록", async () => {
    const store = make_store({
      list_filters: vi.fn().mockResolvedValue([
        { filter_id: "F1", name: "긴급", criteria: { priority: "urgent" } },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_filters", board_id: "B1" });
    expect(r).toContain("F1");
    expect(r).toContain("긴급");
  });

  it("delete_filter: filter_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "delete_filter", filter_id: "" });
    expect(r).toContain("filter_id is required");
  });

  it("delete_filter: 없음 → Error: filter not found", async () => {
    const tool = new KanbanTool(make_store({ delete_filter: vi.fn().mockResolvedValue(false) }));
    const r = await tool.execute({ action: "delete_filter", filter_id: "F999" });
    expect(r).toContain("filter not found");
  });

  it("delete_filter: 성공", async () => {
    const tool = new KanbanTool(make_store({ delete_filter: vi.fn().mockResolvedValue(true) }));
    const r = await tool.execute({ action: "delete_filter", filter_id: "F1" });
    expect(r).toBe("filter deleted");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("KanbanTool — unknown action", () => {
  it("존재하지 않는 action → Error: unknown action", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "nonexistent_action" });
    expect(r).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// add_relation — 필수 필드 누락
// ══════════════════════════════════════════

describe("KanbanTool — add_relation 필수 필드", () => {
  it("source/target/type 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "add_relation", source_card_id: "", target_card_id: "", type: "" });
    expect(r).toContain("source_card_id, target_card_id, and type are required");
  });

  it("관계 추가 성공", async () => {
    const store = make_store({ add_relation: vi.fn().mockResolvedValue({ relation_id: "R1" }) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "add_relation", source_card_id: "KB-1", target_card_id: "KB-2", type: "related_to" });
    expect(r).toContain("KB-1 related_to KB-2");
  });
});
