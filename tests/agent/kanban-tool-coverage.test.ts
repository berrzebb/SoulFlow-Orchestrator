/**
 * KanbanTool — 미커버 분기 보충.
 * get_card 세부 정보(labels/description/metadata/subtasks/relations/comments),
 * board_summary blockers, list_cards 메타데이터,
 * create_card parent_id note, comment/relation 유효성,
 * default action, update_board not found.
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";
import type { KanbanStoreLike } from "@src/services/kanban-store.js";

function make_store(): KanbanStoreLike {
  return {
    create_board: vi.fn(),
    update_board: vi.fn().mockResolvedValue(null),
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

const FULL_CARD = {
  card_id: "KB-1", seq: 1, board_id: "b-1",
  title: "Full Card",
  description: "This is the description",
  column_id: "in_progress",
  position: 0,
  priority: "high",
  labels: ["ui:#3498db", "bug:#e74c3c"],
  created_by: "agent",
  assignee: "user",
  metadata: { pr_url: "https://github.com/pr/1" },
  comment_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ══════════════════════════════════════════
// get_card — 세부 정보 분기
// ══════════════════════════════════════════

describe("KanbanTool — get_card: 세부 정보", () => {
  it("labels, description, metadata 있는 카드 → 상세 출력", async () => {
    const store = make_store();
    (store.get_card as ReturnType<typeof vi.fn>).mockResolvedValue(FULL_CARD);
    (store.list_relations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.get_subtasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    expect(r).toContain("labels:");
    expect(r).toContain("ui:");
    expect(r).toContain("This is the description");
    expect(r).toContain("pr_url");
  });

  it("subtasks 있는 카드 → 서브태스크 목록 출력", async () => {
    const store = make_store();
    (store.get_card as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} });
    (store.list_relations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.get_subtasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { card_id: "KB-2", title: "Subtask A", column_id: "done" },
      { card_id: "KB-3", title: "Subtask B", column_id: "todo" },
    ]);
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    expect(r).toContain("subtasks (1/2)");
    expect(r).toContain("☑ KB-2 Subtask A");
    expect(r).toContain("☐ KB-3 Subtask B");
  });

  it("relations(blocked_by) 있는 카드 → 관계 출력", async () => {
    const store = make_store();
    (store.get_card as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} });
    (store.list_relations as ReturnType<typeof vi.fn>).mockResolvedValue([
      { relation_id: "r1", source_card_id: "KB-1", target_card_id: "KB-99", type: "blocked_by" },
    ]);
    (store.get_subtasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    expect(r).toContain("relations:");
    expect(r).toContain("blocked_by");
    expect(r).toContain("KB-99");
  });

  it("comments 있는 카드 → 코멘트 출력", async () => {
    const store = make_store();
    (store.get_card as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} });
    (store.list_relations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.get_subtasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([
      { comment_id: "c1", card_id: "KB-1", author: "agent", text: "좋은 진행!", created_at: "2026-01-01" },
    ]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    expect(r).toContain("comments:");
    expect(r).toContain("[agent]");
    expect(r).toContain("좋은 진행!");
  });

  it("parent_of/child_of 관계는 non_subtask에서 제외됨", async () => {
    const store = make_store();
    (store.get_card as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} });
    (store.list_relations as ReturnType<typeof vi.fn>).mockResolvedValue([
      { relation_id: "r1", source_card_id: "KB-1", target_card_id: "KB-2", type: "parent_of" },
    ]);
    (store.get_subtasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
    // parent_of는 non_subtask에서 제외 → relations: 블록 없음
    expect(r).not.toContain("relations:");
  });
});

// ══════════════════════════════════════════
// board_summary — blockers 있는 경우
// ══════════════════════════════════════════

describe("KanbanTool — board_summary: blockers", () => {
  it("blockers 있음 → blockers 출력", async () => {
    const store = make_store();
    (store.board_summary as ReturnType<typeof vi.fn>).mockResolvedValue({
      board_id: "b-1", name: "Sprint Board",
      columns: [{ id: "todo", name: "TODO", color: "#aaa", count: 1 }],
      total: 3, done: 1,
      blockers: [
        { card_id: "KB-2", title: "Blocked Task", blocked_by: ["KB-5", "KB-6"] },
      ],
    });

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "board_summary", board_id: "b-1" });
    expect(r).toContain("blockers:");
    expect(r).toContain("KB-2");
    expect(r).toContain("blocked_by KB-5, KB-6");
  });
});

// ══════════════════════════════════════════
// list_cards — 메타데이터 분기
// ══════════════════════════════════════════

describe("KanbanTool — list_cards: priority/assignee/comment_count", () => {
  it("카드에 priority, assignee, comment_count 있음 → 표시됨", async () => {
    const store = make_store();
    (store.list_cards as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        card_id: "KB-3", title: "Priority Card", column_id: "todo",
        priority: "urgent", assignee: "alice", comment_count: 3,
      },
    ]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_cards", board_id: "b-1" });
    expect(r).toContain("P:urgent");
    expect(r).toContain("→alice");
    expect(r).toContain("💬3");
  });
});

// ══════════════════════════════════════════
// create_card — parent_id note
// ══════════════════════════════════════════

describe("KanbanTool — create_card: parent_id note", () => {
  it("parent_id 있으면 '(child of ...)' 메시지 포함", async () => {
    const store = make_store();
    (store.create_card as ReturnType<typeof vi.fn>).mockResolvedValue({
      card_id: "KB-4", title: "Subtask", column_id: "todo",
    });

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "create_card", board_id: "b-1", title: "Subtask", parent_id: "KB-1" });
    expect(r).toContain("child of KB-1");
  });
});

// ══════════════════════════════════════════
// comment — 유효성 검사
// ══════════════════════════════════════════

describe("KanbanTool — comment: 유효성", () => {
  it("card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "comment", text: "hello" });
    expect(r).toContain("Error");
    expect(r).toContain("card_id and text");
  });

  it("text 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "comment", card_id: "KB-1" });
    expect(r).toContain("Error");
    expect(r).toContain("card_id and text");
  });
});

// ══════════════════════════════════════════
// list_comments — 코멘트 있는 경우
// ══════════════════════════════════════════

describe("KanbanTool — list_comments", () => {
  it("코멘트 있음 → 목록 반환", async () => {
    const store = make_store();
    (store.list_comments as ReturnType<typeof vi.fn>).mockResolvedValue([
      { comment_id: "c1", card_id: "KB-1", author: "agent", text: "LGTM", created_at: "2026-01-01T12:00:00Z" },
    ]);

    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_comments", card_id: "KB-1" });
    expect(r).toContain("[agent 2026-01-01T12:00:00Z] LGTM");
  });
});

// ══════════════════════════════════════════
// add_relation — 유효성 검사
// ══════════════════════════════════════════

describe("KanbanTool — add_relation: 유효성", () => {
  it("source_card_id 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "add_relation", target_card_id: "KB-2", type: "blocked_by" });
    expect(r).toContain("Error");
    expect(r).toContain("required");
  });

  it("type 없음 → Error", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "add_relation", source_card_id: "KB-1", target_card_id: "KB-2" });
    expect(r).toContain("Error");
    expect(r).toContain("required");
  });
});

// ══════════════════════════════════════════
// update_board — board not found
// ══════════════════════════════════════════

describe("KanbanTool — update_board: board not found", () => {
  it("보드 없음 → Error", async () => {
    const store = make_store();
    // update_board returns null by default in make_store
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "update_board", board_id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });
});

// ══════════════════════════════════════════
// default action
// ══════════════════════════════════════════

describe("KanbanTool — default action", () => {
  it("알 수 없는 action → Error + 사용 가능한 액션 목록", async () => {
    const tool = new KanbanTool(make_store());
    const r = await tool.execute({ action: "nonexistent_action" });
    expect(r).toContain("Error");
    expect(r).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// toggle_rule — disabled + rule_executor watch
// ══════════════════════════════════════════

describe("KanbanTool — toggle_rule: 비활성화 + watch", () => {
  it("비활성화 → 'disabled' 메시지", async () => {
    const store = make_store();
    (store.update_rule as ReturnType<typeof vi.fn>).mockResolvedValue({ rule_id: "r1", board_id: "KB-1", enabled: false });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: false });
    expect(r).toContain("disabled");
  });

  it("활성화 + rule_executor 있음 → watch() 호출", async () => {
    const store = make_store();
    (store.update_rule as ReturnType<typeof vi.fn>).mockResolvedValue({ rule_id: "r1", board_id: "KB-2", enabled: true });
    const tool = new KanbanTool(store);
    const mock_watch = vi.fn();
    tool.set_rule_executor({ watch: mock_watch } as any);
    await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: true });
    expect(mock_watch).toHaveBeenCalledWith("KB-2");
  });
});
