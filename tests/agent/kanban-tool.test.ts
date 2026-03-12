import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";
import type { KanbanStoreLike, KanbanBoard, KanbanCard, KanbanComment, KanbanRelation, BoardSummary } from "@src/services/kanban-store.js";

/* ─── 헬퍼 ─── */

function make_board(overrides?: Partial<KanbanBoard>): KanbanBoard {
  return {
    board_id: "b-1", name: "Test Board", prefix: "TB", next_seq: 1,
    scope_type: "channel", scope_id: "ch1",
    columns: [
      { id: "todo", name: "TODO", color: "#95a5a6" },
      { id: "done", name: "Done", color: "#27ae60" },
    ],
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function make_card(overrides?: Partial<KanbanCard>): KanbanCard {
  return {
    card_id: "TB-1", seq: 1, board_id: "b-1", title: "Task 1",
    description: "", column_id: "todo", position: 0, priority: "none",
    labels: [], created_by: "agent", metadata: {}, comment_count: 0,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function make_store(overrides: Partial<KanbanStoreLike> = {}): KanbanStoreLike {
  return {
    create_board: vi.fn().mockResolvedValue(make_board()),
    get_board: vi.fn().mockResolvedValue(null),
    list_boards: vi.fn().mockResolvedValue([]),
    update_board: vi.fn().mockResolvedValue(null),
    delete_board: vi.fn().mockResolvedValue(false),
    create_card: vi.fn().mockResolvedValue(make_card()),
    get_card: vi.fn().mockResolvedValue(null),
    list_cards: vi.fn().mockResolvedValue([]),
    move_card: vi.fn().mockResolvedValue(null),
    update_card: vi.fn().mockResolvedValue(null),
    delete_card: vi.fn().mockResolvedValue(false),
    add_comment: vi.fn().mockResolvedValue({ comment_id: "c-1", card_id: "TB-1", author: "agent", text: "hi", created_at: "2026-01-01" } satisfies KanbanComment),
    list_comments: vi.fn().mockResolvedValue([]),
    add_relation: vi.fn().mockResolvedValue({ relation_id: "r-1", source_card_id: "TB-1", target_card_id: "TB-2", type: "blocked_by" } satisfies KanbanRelation),
    remove_relation: vi.fn().mockResolvedValue(false),
    list_relations: vi.fn().mockResolvedValue([]),
    get_card_by_readable_id: vi.fn().mockResolvedValue(null),
    board_summary: vi.fn().mockResolvedValue(null),
    get_subtasks: vi.fn().mockResolvedValue([]),
    get_participants: vi.fn().mockResolvedValue(["agent"]),
    list_activities: vi.fn().mockResolvedValue([]),
    add_rule: vi.fn().mockResolvedValue({ rule_id: "R1", board_id: "B1", trigger: "card_moved", action_type: "comment", condition: {}, action_params: {}, enabled: true }),
    list_rules: vi.fn().mockResolvedValue([]),
    remove_rule: vi.fn().mockResolvedValue(false),
    update_rule: vi.fn().mockResolvedValue(null),
    create_template: vi.fn().mockResolvedValue({ template_id: "T1", name: "Template", cards: [] }),
    list_templates: vi.fn().mockResolvedValue([]),
    get_template: vi.fn().mockResolvedValue(null),
    delete_template: vi.fn().mockResolvedValue(false),
    get_board_metrics: vi.fn().mockResolvedValue(null),
    get_card_time_tracking: vi.fn().mockResolvedValue(null),
    search_cards: vi.fn().mockResolvedValue([]),
    save_filter: vi.fn().mockResolvedValue({ filter_id: "F1", name: "Filter", criteria: {} }),
    list_filters: vi.fn().mockResolvedValue([]),
    delete_filter: vi.fn().mockResolvedValue(false),
    ...overrides,
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

const ctx = { sender_id: "agent" };

/* ─── 메타 ─── */

describe("KanbanTool", () => {
  it("name과 category", () => {
    const tool = new KanbanTool(make_store());
    expect(tool.name).toBe("kanban");
    expect(tool.category).toBe("admin");
  });

  /* ═══════════════════════════════════════════
   * 보드 액션
   * ═══════════════════════════════════════════ */

  describe("보드 액션", () => {
    it("create_board 성공", async () => {
      const store = make_store();
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_board", name: "Sprint", scope_type: "channel", scope_id: "ch1" }, ctx);
      expect(result).toContain("ok");
      expect(store.create_board).toHaveBeenCalled();
    });

    it("create_board — name 누락 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "create_board" }, ctx);
      expect(result).toContain("Error");
    });

    it("create_board — scope_type 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_board", name: "보드명", scope_id: "ch1" });
      expect(r).toContain("scope_type and scope_id are required");
    });

    it("create_board — scope_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_board", name: "보드명", scope_type: "channel" });
      expect(r).toContain("scope_type and scope_id are required");
    });

    it("list_boards — 목록 있음", async () => {
      const store = make_store({
        list_boards: vi.fn().mockResolvedValue([
          { board_id: "B1", name: "내 보드", scope_type: "channel", scope_id: "ch1", prefix: "MB" },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_boards" }, ctx);
      expect(r).toContain("B1");
      expect(r).toContain("내 보드");
    });

    it("list_boards — 빈 목록 → '보드 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "list_boards" }, ctx);
      expect(result).toContain("보드 없음");
    });

    it("update_board — 이름 변경 성공", async () => {
      const store = make_store({
        update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "새 이름" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "update_board", board_id: "B1", name: "새 이름" });
      expect(r).toContain("B1");
      expect(r).toContain("새 이름");
    });

    it("update_board — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "update_board", board_id: "" });
      expect(r).toContain("board_id is required");
    });

    it("update_board — board not found", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "update_board", board_id: "ghost" });
      expect(r).toContain("Error");
      expect(r).toContain("not found");
    });

    it("update_board — columns 파라미터 포함", async () => {
      const store = make_store({
        update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "업데이트" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({
        action: "update_board",
        board_id: "B1",
        columns: [{ id: "todo", name: "할 일" }],
      });
      expect(r).toContain("B1");
      const call_args = vi.mocked(store.update_board).mock.calls[0];
      expect(call_args[1]).toHaveProperty("columns");
    });
  });

  /* ═══════════════════════════════════════════
   * 카드 액션
   * ═══════════════════════════════════════════ */

  describe("카드 액션", () => {
    it("create_card 성공", async () => {
      const store = make_store({
        create_card: vi.fn().mockResolvedValue(make_card()),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_card", board_id: "b-1", title: "New" }, ctx);
      expect(result).toContain("TB-1");
      expect(result).toContain("created");
    });

    it("create_card — board_id/title 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_card", board_id: "", title: "" });
      expect(r).toContain("board_id and title are required");
    });

    it("create_card — 동일 제목 카드 이미 있음 → already exists", async () => {
      const store = make_store({
        list_cards: vi.fn().mockResolvedValue([
          { card_id: "KB-1", title: "기존 카드", column_id: "todo" },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "create_card", board_id: "B1", title: "기존 카드" });
      expect(r).toContain("already exists");
    });

    it("create_card — parent_id 있으면 '(child of ...)' 포함", async () => {
      const store = make_store({
        create_card: vi.fn().mockResolvedValue({ card_id: "KB-4", title: "Subtask", column_id: "todo" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "create_card", board_id: "b-1", title: "Subtask", parent_id: "KB-1" });
      expect(r).toContain("child of KB-1");
    });

    it("move_card 성공", async () => {
      const store = make_store({
        move_card: vi.fn().mockResolvedValue(make_card({ column_id: "done" })),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "move_card", card_id: "TB-1", column_id: "done" }, ctx);
      expect(result).toContain("moved");
    });

    it("move_card — 필수 필드 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "move_card", card_id: "", column_id: "" });
      expect(r).toContain("card_id and column_id are required");
    });

    it("move_card — 없는 카드 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "move_card", card_id: "NOPE-1", column_id: "done" }, ctx);
      expect(result).toContain("card not found");
    });

    it("update_card 성공", async () => {
      const store = make_store({
        update_card: vi.fn().mockResolvedValue(make_card({ title: "Updated" })),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "update_card", card_id: "TB-1", title: "Updated" }, ctx);
      expect(result).toContain("updated");
    });

    it("update_card — card_id 누락 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "update_card" });
      expect(r).toContain("card_id is required");
    });

    it("update_card — store null 반환 (not found)", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "update_card", card_id: "KB-999" });
      expect(r).toContain("card not found");
      expect(r).toContain("KB-999");
    });

    it("update_card — assignee=null로 클리어", async () => {
      const store = make_store({
        update_card: vi.fn().mockResolvedValue({ card_id: "ISS-1" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "update_card", card_id: "ISS-1", assignee: null });
      expect(r).toContain("ISS-1 updated");
      const call_arg = (store.update_card as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(call_arg.assignee).toBeNull();
    });

    it("update_card — due_date=null로 클리어", async () => {
      const store = make_store({
        update_card: vi.fn().mockResolvedValue({ card_id: "ISS-2" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "update_card", card_id: "ISS-2", due_date: null });
      expect(r).toContain("ISS-2 updated");
      const call_arg = (store.update_card as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(call_arg.due_date).toBeNull();
    });

    it("archive_card 성공", async () => {
      const store = make_store({ delete_card: vi.fn().mockResolvedValue(true) });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "archive_card", card_id: "TB-1" }, ctx);
      expect(result).toContain("archived");
    });

    it("archive_card — 카드 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "archive_card", card_id: "ISS-999" });
      expect(r).toContain("Error: card not found");
    });

    it("archive_card — card_id 누락 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "archive_card" });
      expect(r).toContain("card_id is required");
    });

    it("list_cards — 목록 있음", async () => {
      const store = make_store({
        list_cards: vi.fn().mockResolvedValue([make_card()]),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "list_cards", board_id: "b-1" }, ctx);
      expect(result).toContain("TB-1");
    });

    it("list_cards — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_cards", board_id: "" });
      expect(r).toContain("board_id is required");
    });

    it("list_cards — 빈 목록 → '카드 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_cards", board_id: "B1" });
      expect(r).toBe("카드 없음");
    });

    it("list_cards — priority/assignee/comment_count 표시", async () => {
      const store = make_store({
        list_cards: vi.fn().mockResolvedValue([
          { card_id: "KB-1", title: "태스크", column_id: "todo", priority: "high", assignee: "alice", comment_count: 3 },
          { card_id: "KB-2", title: "태스크2", column_id: "done", priority: "none", assignee: null, comment_count: 0 },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_cards", board_id: "B1" });
      expect(r).toContain("P:high");
      expect(r).toContain("→alice");
      expect(r).toContain("💬3");
      expect(r).not.toContain("P:none");
    });

    it("get_card — 기본 카드", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue(make_card()),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "get_card", card_id: "TB-1" }, ctx);
      expect(result).toContain("Task 1");
    });

    it("get_card — card_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "get_card", card_id: "" });
      expect(r).toContain("card_id is required");
    });

    it("get_card — 없는 카드 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "get_card", card_id: "KB-999" });
      expect(r).toContain("card not found");
    });

    it("get_card — labels/description/metadata 상세 출력", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue(FULL_CARD),
        list_relations: vi.fn().mockResolvedValue([]),
        get_subtasks: vi.fn().mockResolvedValue([]),
        list_comments: vi.fn().mockResolvedValue([]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
      expect(r).toContain("labels:");
      expect(r).toContain("ui:");
      expect(r).toContain("This is the description");
      expect(r).toContain("pr_url");
    });

    it("get_card — subtasks 있음 → 서브태스크 목록 출력", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} }),
        list_relations: vi.fn().mockResolvedValue([]),
        get_subtasks: vi.fn().mockResolvedValue([
          { card_id: "KB-2", title: "Subtask A", column_id: "done" },
          { card_id: "KB-3", title: "Subtask B", column_id: "todo" },
        ]),
        list_comments: vi.fn().mockResolvedValue([]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
      expect(r).toContain("subtasks (1/2)");
      expect(r).toContain("☑ KB-2 Subtask A");
      expect(r).toContain("☐ KB-3 Subtask B");
    });

    it("get_card — relations(blocked_by) 있음 → 관계 출력", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} }),
        list_relations: vi.fn().mockResolvedValue([
          { relation_id: "r1", source_card_id: "KB-1", target_card_id: "KB-99", type: "blocked_by" },
        ]),
        get_subtasks: vi.fn().mockResolvedValue([]),
        list_comments: vi.fn().mockResolvedValue([]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
      expect(r).toContain("relations:");
      expect(r).toContain("blocked_by");
      expect(r).toContain("KB-99");
    });

    it("get_card — parent_of/child_of 관계는 non_subtask에서 제외됨", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} }),
        list_relations: vi.fn().mockResolvedValue([
          { relation_id: "r1", source_card_id: "KB-1", target_card_id: "KB-2", type: "parent_of" },
        ]),
        get_subtasks: vi.fn().mockResolvedValue([]),
        list_comments: vi.fn().mockResolvedValue([]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
      expect(r).not.toContain("relations:");
    });

    it("get_card — comments 있음 → 코멘트 출력", async () => {
      const store = make_store({
        get_card: vi.fn().mockResolvedValue({ ...FULL_CARD, labels: [], description: "", metadata: {} }),
        list_relations: vi.fn().mockResolvedValue([]),
        get_subtasks: vi.fn().mockResolvedValue([]),
        list_comments: vi.fn().mockResolvedValue([
          { comment_id: "c1", card_id: "KB-1", author: "agent", text: "좋은 진행!", created_at: "2026-01-01" },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "get_card", card_id: "KB-1" });
      expect(r).toContain("comments:");
      expect(r).toContain("[agent]");
      expect(r).toContain("좋은 진행!");
    });

    it("get_card — labels/description/metadata + subtask/relation/comment 모두 있음", async () => {
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

  /* ═══════════════════════════════════════════
   * board_summary
   * ═══════════════════════════════════════════ */

  describe("board_summary", () => {
    it("기본 summary", async () => {
      const store = make_store({
        board_summary: vi.fn().mockResolvedValue({
          board_id: "b-1", name: "Test Board",
          columns: [{ id: "todo", name: "TODO", color: "#95a5a6", count: 2 }],
          total: 2, done: 0, blockers: [],
        } satisfies BoardSummary),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "board_summary", board_id: "b-1" }, ctx);
      expect(result).toContain("Test Board");
      expect(result).toContain("0/2");
    });

    it("board_id 누락 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "board_summary" });
      expect(r).toContain("board_id is required");
    });

    it("board not found", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "board_summary", board_id: "nonexistent" });
      expect(r).toContain("board not found");
      expect(r).toContain("nonexistent");
    });

    it("blockers 있음 → blockers 출력", async () => {
      const store = make_store({
        board_summary: vi.fn().mockResolvedValue({
          board_id: "b-1", name: "Sprint Board",
          columns: [{ id: "todo", name: "TODO", color: "#aaa", count: 1 }],
          total: 3, done: 1,
          blockers: [
            { card_id: "KB-2", title: "Blocked Task", blocked_by: ["KB-5", "KB-6"] },
          ],
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "board_summary", board_id: "b-1" });
      expect(r).toContain("blockers:");
      expect(r).toContain("KB-2");
      expect(r).toContain("blocked_by KB-5, KB-6");
    });

    it("total=0 → 0% 진행률", async () => {
      const store = make_store({
        board_summary: vi.fn().mockResolvedValue({
          name: "빈 보드", total: 0, done: 0,
          columns: [{ name: "todo", count: 0 }],
          blockers: [],
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "board_summary", board_id: "B1" });
      expect(r).toContain("0/0 done (0%)");
    });
  });

  /* ═══════════════════════════════════════════
   * 코멘트 액션
   * ═══════════════════════════════════════════ */

  describe("코멘트 액션", () => {
    it("comment 성공", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "comment", card_id: "TB-1", text: "hello" }, ctx);
      expect(result).toContain("comment added");
    });

    it("comment — card_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "comment", text: "hello" });
      expect(r).toContain("Error");
      expect(r).toContain("card_id and text");
    });

    it("comment — text 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "comment", card_id: "TB-1" }, ctx);
      expect(result).toContain("Error");
    });

    it("comment — card_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "comment", card_id: "", text: "메모" });
      expect(r).toContain("card_id and text are required");
    });

    it("comment — text 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "comment", card_id: "KB-1", text: "" });
      expect(r).toContain("card_id and text are required");
    });

    it("list_comments — 빈 목록 → '코멘트 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "list_comments", card_id: "TB-1" }, ctx);
      expect(result).toContain("코멘트 없음");
    });

    it("list_comments — card_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_comments", card_id: "" });
      expect(r).toContain("card_id is required");
    });

    it("list_comments — 코멘트 있음 → 목록 반환", async () => {
      const store = make_store({
        list_comments: vi.fn().mockResolvedValue([
          { comment_id: "c1", card_id: "KB-1", author: "agent", text: "LGTM", created_at: "2026-01-01T12:00:00Z" },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_comments", card_id: "KB-1" });
      expect(r).toContain("[agent 2026-01-01T12:00:00Z] LGTM");
    });
  });

  /* ═══════════════════════════════════════════
   * 관계 액션
   * ═══════════════════════════════════════════ */

  describe("관계 액션", () => {
    it("add_relation 성공", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({
        action: "add_relation", source_card_id: "TB-1", target_card_id: "TB-2", type: "blocked_by",
      }, ctx);
      expect(result).toContain("relation added");
    });

    it("add_relation — source_card_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "add_relation", target_card_id: "KB-2", type: "blocked_by" });
      expect(r).toContain("Error");
      expect(r).toContain("required");
    });

    it("add_relation — type 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "add_relation", source_card_id: "KB-1", target_card_id: "KB-2" });
      expect(r).toContain("Error");
      expect(r).toContain("required");
    });

    it("add_relation — 모든 필드 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "add_relation", source_card_id: "", target_card_id: "", type: "" });
      expect(r).toContain("source_card_id, target_card_id, and type are required");
    });

    it("remove_relation 성공", async () => {
      const store = make_store({ remove_relation: vi.fn().mockResolvedValue(true) });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "remove_relation", relation_id: "r-1" }, ctx);
      expect(result).toContain("relation removed");
    });

    it("remove_relation — relation_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "remove_relation", relation_id: "" });
      expect(r).toContain("relation_id is required");
    });

    it("remove_relation — 없는 관계 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "remove_relation", relation_id: "nope" }, ctx);
      expect(result).toContain("relation not found");
    });
  });

  /* ═══════════════════════════════════════════
   * list_activities
   * ═══════════════════════════════════════════ */

  describe("list_activities", () => {
    it("card_id와 board_id 모두 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_activities" });
      expect(r).toContain("Error");
      expect(r).toContain("card_id or board_id");
    });

    it("활동 없음 → '활동 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_activities", board_id: "KB-1" });
      expect(r).toContain("활동 없음");
    });

    it("활동 있음 → 목록 반환", async () => {
      const store = make_store({
        list_activities: vi.fn().mockResolvedValue([
          { created_at: "2026-01-01T00:00:00Z", actor: "agent", action: "moved", card_id: "KB-1", detail: { to: "done" } },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_activities", board_id: "KB-1" });
      expect(r).toContain("agent");
      expect(r).toContain("KB-1");
    });

    it("detail 객체 있는 활동 → JSON 직렬화 출력", async () => {
      const store = make_store({
        list_activities: vi.fn().mockResolvedValue([
          {
            created_at: "2026-01-01T10:00Z", actor: "agent",
            action: "moved", card_id: "ISS-1",
            detail: { from: "todo", to: "in_progress" },
          },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_activities", card_id: "ISS-1" });
      expect(r).toContain("from");
      expect(r).toContain("to");
    });

    it("detail 빈 객체 → JSON 없이 출력", async () => {
      const store = make_store({
        list_activities: vi.fn().mockResolvedValue([
          {
            created_at: "2026-01-01T10:00Z", actor: "agent",
            action: "created", card_id: "ISS-1",
            detail: {},
          },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_activities", board_id: "B1" });
      expect(r).toContain("created");
      expect(r).not.toContain("{}");
    });
  });

  /* ═══════════════════════════════════════════
   * 규칙 액션 (add_rule, list_rules, remove_rule, toggle_rule)
   * ═══════════════════════════════════════════ */

  describe("규칙 액션", () => {
    it("add_rule — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "add_rule", trigger: "card_moved", action_type: "comment" });
      expect(r).toContain("Error");
      expect(r).toContain("board_id");
    });

    it("add_rule 성공", async () => {
      const store = make_store({
        add_rule: vi.fn().mockResolvedValue({
          rule_id: "rule-1", board_id: "KB-1", trigger: "card_moved", action_type: "comment",
          condition: {}, action_params: {}, enabled: true,
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({
        action: "add_rule", board_id: "KB-1",
        trigger: "card_moved", action_type: "comment",
      });
      expect(r).toContain("rule created");
      expect(r).toContain("rule-1");
    });

    it("add_rule — rule_executor 있을 때 watch() 호출", async () => {
      const store = make_store({
        add_rule: vi.fn().mockResolvedValue({
          rule_id: "r1", board_id: "KB-1", trigger: "card_moved", action_type: "assign",
          condition: {}, action_params: {}, enabled: true,
        }),
      });
      const tool = new KanbanTool(store);
      const mock_watch = vi.fn();
      tool.set_rule_executor({ watch: mock_watch } as unknown as import("@src/services/kanban-rule-executor.js").KanbanRuleExecutor);
      await tool.execute({ action: "add_rule", board_id: "KB-1", trigger: "card_moved", action_type: "assign" });
      expect(mock_watch).toHaveBeenCalledWith("KB-1");
    });

    it("list_rules — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_rules" });
      expect(r).toContain("Error");
    });

    it("list_rules — board_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_rules", board_id: "" });
      expect(r).toContain("board_id is required");
    });

    it("list_rules — 규칙 없음 → '규칙 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_rules", board_id: "KB-1" });
      expect(r).toContain("규칙 없음");
    });

    it("list_rules — 규칙 있음 → 목록 반환", async () => {
      const store = make_store({
        list_rules: vi.fn().mockResolvedValue([
          { rule_id: "r1", trigger: "card_moved", action_type: "comment", enabled: true, condition: {} },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_rules", board_id: "KB-1" });
      expect(r).toContain("r1");
      expect(r).toContain("card_moved");
    });

    it("remove_rule — rule_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "remove_rule" });
      expect(r).toContain("Error");
    });

    it("remove_rule — rule_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "remove_rule", rule_id: "" });
      expect(r).toContain("rule_id is required");
    });

    it("remove_rule — 없는 rule → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "remove_rule", rule_id: "r-ghost" });
      expect(r).toContain("Error");
    });

    it("remove_rule 성공", async () => {
      const store = make_store({ remove_rule: vi.fn().mockResolvedValue(true) });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "remove_rule", rule_id: "r1" });
      expect(r).toContain("rule removed");
    });

    it("toggle_rule — rule_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "toggle_rule" });
      expect(r).toContain("Error");
    });

    it("toggle_rule — rule_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "toggle_rule", rule_id: "" });
      expect(r).toContain("rule_id is required");
    });

    it("toggle_rule — 없는 rule → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "toggle_rule", rule_id: "ghost" });
      expect(r).toContain("Error");
    });

    it("toggle_rule — 활성화 성공", async () => {
      const store = make_store({
        update_rule: vi.fn().mockResolvedValue({ rule_id: "r1", board_id: "KB-1", enabled: true }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: true });
      expect(r).toContain("enabled");
    });

    it("toggle_rule — 비활성화 → 'disabled'", async () => {
      const store = make_store({
        update_rule: vi.fn().mockResolvedValue({ rule_id: "r1", board_id: "KB-1", enabled: false }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: false });
      expect(r).toContain("disabled");
    });

    it("toggle_rule — 활성화 + rule_executor 있음 → watch() 호출", async () => {
      const store = make_store({
        update_rule: vi.fn().mockResolvedValue({ rule_id: "r1", board_id: "KB-2", enabled: true }),
      });
      const tool = new KanbanTool(store);
      const mock_watch = vi.fn();
      tool.set_rule_executor({ watch: mock_watch } as any);
      await tool.execute({ action: "toggle_rule", rule_id: "r1", enabled: true });
      expect(mock_watch).toHaveBeenCalledWith("KB-2");
    });
  });

  /* ═══════════════════════════════════════════
   * 템플릿 액션
   * ═══════════════════════════════════════════ */

  describe("템플릿 액션", () => {
    it("create_template — name 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_template", cards: [{ title: "Card 1" }] });
      expect(r).toContain("Error");
      expect(r).toContain("name");
    });

    it("create_template — name 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_template", name: "" });
      expect(r).toContain("name is required");
    });

    it("create_template — cards 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_template", name: "My Template" });
      expect(r).toContain("Error");
      expect(r).toContain("cards");
    });

    it("create_template — cards 빈 배열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_template", name: "내 템플릿", cards: [] });
      expect(r).toContain("cards array is required");
    });

    it("create_template 성공", async () => {
      const store = make_store({
        create_template: vi.fn().mockResolvedValue({
          template_id: "tmpl-1", name: "Sprint Template", cards: [{ title: "Task 1" }], columns: [],
        }),
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

    it("list_templates — 빈 목록 → '템플릿 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_templates" });
      expect(r).toContain("템플릿 없음");
    });

    it("list_templates — 목록 있음", async () => {
      const store = make_store({
        list_templates: vi.fn().mockResolvedValue([
          { template_id: "t1", name: "Sprint", cards: [{ title: "c1" }, { title: "c2" }], columns: [] },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_templates" });
      expect(r).toContain("Sprint");
      expect(r).toContain("2 cards");
    });

    it("create_board_from_template — template_name 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_board_from_template", scope_type: "channel", scope_id: "C1" });
      expect(r).toContain("Error");
      expect(r).toContain("template_name");
    });

    it("create_board_from_template — template_name 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_board_from_template", template_name: "", scope_type: "channel", scope_id: "ch1" });
      expect(r).toContain("template_name or template_id is required");
    });

    it("create_board_from_template — scope 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "create_board_from_template", template_name: "템플릿", scope_type: "", scope_id: "" });
      expect(r).toContain("scope_type and scope_id are required");
    });

    it("create_board_from_template — template 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({
        action: "create_board_from_template",
        template_name: "ghost-template",
        scope_type: "channel", scope_id: "C1",
      });
      expect(r).toContain("Error");
      expect(r).toContain("template not found");
    });

    it("create_board_from_template 성공", async () => {
      const store = make_store({
        get_template: vi.fn().mockResolvedValue({
          template_id: "t1", name: "Sprint",
          cards: [{ title: "Task A", column_id: "todo" }],
          columns: [{ id: "todo", name: "To Do", color: "#fff" }],
        }),
        create_board: vi.fn().mockResolvedValue({
          board_id: "KB-10", prefix: "KB", name: "Sprint",
          columns: [{ id: "todo", name: "To Do", color: "#fff" }],
        }),
        create_card: vi.fn().mockResolvedValue({ card_id: "KB-1", title: "Task A", column_id: "todo" }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({
        action: "create_board_from_template",
        template_name: "Sprint",
        scope_type: "channel", scope_id: "C1",
      });
      expect(r).toContain("KB-10");
      expect(r).toContain("1 cards");
    });

    it("create_board_from_template — columns 없는 template로 성공", async () => {
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
        template_name: "애자일", scope_type: "channel", scope_id: "ch1",
      });
      expect(r).toContain("B2");
      expect(r).toContain("1 cards");
    });

    it("delete_template — template_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_template" });
      expect(r).toContain("Error");
    });

    it("delete_template — template_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_template", template_id: "" });
      expect(r).toContain("template_id is required");
    });

    it("delete_template — 없는 template → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_template", template_id: "ghost" });
      expect(r).toContain("Error");
      expect(r).toContain("template not found");
    });

    it("delete_template 성공", async () => {
      const store = make_store({ delete_template: vi.fn().mockResolvedValue(true) });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "delete_template", template_id: "t1" });
      expect(r).toContain("template deleted");
    });
  });

  /* ═══════════════════════════════════════════
   * board_metrics
   * ═══════════════════════════════════════════ */

  describe("board_metrics", () => {
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
      const store = make_store({
        get_board_metrics: vi.fn().mockResolvedValue({
          throughput: 5,
          avg_cycle_time_hours: 24,
          cards_by_column: { todo: 2, done: 5 },
          cards_by_priority: { high: 3, low: 4 },
          velocity: [{ week: "2026-W01", done: 3 }],
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "board_metrics", board_id: "KB-1", days: 7 });
      expect(r).toContain("throughput: 5");
      expect(r).toContain("velocity");
    });

    it("velocity 다수 항목 포함", async () => {
      const store = make_store({
        get_board_metrics: vi.fn().mockResolvedValue({
          throughput: 5,
          avg_cycle_time_hours: 12,
          cards_by_column: { todo: 2, in_progress: 1, done: 5 },
          cards_by_priority: { high: 3, medium: 4, low: 1, none: 0 },
          velocity: [
            { week: "2026-W10", done: 3 },
            { week: "2026-W11", done: 2 },
          ],
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "board_metrics", board_id: "B1" });
      expect(r).toContain("velocity");
      expect(r).toContain("2026-W10");
      expect(r).toContain("done");
    });
  });

  /* ═══════════════════════════════════════════
   * card_time_tracking
   * ═══════════════════════════════════════════ */

  describe("card_time_tracking", () => {
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

    it("시간 추적 반환 (← current 표시)", async () => {
      const store = make_store({
        get_card_time_tracking: vi.fn().mockResolvedValue({
          total_hours: 8,
          column_times: [
            { column_id: "todo", duration_hours: 2, exited_at: "2026-01-01" },
            { column_id: "in_progress", duration_hours: 6, exited_at: null },
          ],
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "card_time_tracking", card_id: "KB-1" });
      expect(r).toContain("8h");
      expect(r).toContain("in_progress");
      expect(r).toContain("← current");
    });
  });

  /* ═══════════════════════════════════════════
   * search
   * ═══════════════════════════════════════════ */

  describe("search", () => {
    it("query 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "search" });
      expect(r).toContain("Error");
      expect(r).toContain("query");
    });

    it("query 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "search", query: "" });
      expect(r).toContain("query is required");
    });

    it("결과 없음 → '검색 결과 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "search", query: "no match here" });
      expect(r).toContain("검색 결과 없음");
    });

    it("결과 반환", async () => {
      const store = make_store({
        search_cards: vi.fn().mockResolvedValue([
          { card_id: "KB-1", title: "Fix bug", board_name: "Main", column_id: "in_progress", priority: "high" },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "search", query: "bug" });
      expect(r).toContain("KB-1");
      expect(r).toContain("Fix bug");
    });

    it("결과 반환 — P:high 포함", async () => {
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

  /* ═══════════════════════════════════════════
   * 필터 액션 (save_filter, list_filters, delete_filter)
   * ═══════════════════════════════════════════ */

  describe("필터 액션", () => {
    it("save_filter — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "save_filter", name: "my filter" });
      expect(r).toContain("Error");
      expect(r).toContain("board_id");
    });

    it("save_filter — board_id/name 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "save_filter", board_id: "", name: "" });
      expect(r).toContain("board_id and name are required");
    });

    it("save_filter 성공", async () => {
      const store = make_store({
        save_filter: vi.fn().mockResolvedValue({
          filter_id: "f1", name: "Urgent", criteria: { priority: "urgent" }, board_id: "KB-1",
        }),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "save_filter", board_id: "KB-1", name: "Urgent", criteria: { priority: "urgent" } });
      expect(r).toContain("filter saved");
      expect(r).toContain("f1");
    });

    it("list_filters — board_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_filters" });
      expect(r).toContain("Error");
    });

    it("list_filters — board_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_filters", board_id: "" });
      expect(r).toContain("board_id is required");
    });

    it("list_filters — 빈 목록 → '필터 없음'", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "list_filters", board_id: "KB-1" });
      expect(r).toContain("필터 없음");
    });

    it("list_filters — 필터 목록 반환", async () => {
      const store = make_store({
        list_filters: vi.fn().mockResolvedValue([
          { filter_id: "f1", name: "Urgent", criteria: { priority: "urgent" } },
        ]),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "list_filters", board_id: "KB-1" });
      expect(r).toContain("f1");
      expect(r).toContain("Urgent");
    });

    it("delete_filter — filter_id 없음 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_filter" });
      expect(r).toContain("Error");
      expect(r).toContain("filter_id");
    });

    it("delete_filter — filter_id 빈 문자열 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_filter", filter_id: "" });
      expect(r).toContain("filter_id is required");
    });

    it("delete_filter — 없는 필터 → Error", async () => {
      const tool = new KanbanTool(make_store());
      const r = await tool.execute({ action: "delete_filter", filter_id: "ghost" });
      expect(r).toContain("Error");
      expect(r).toContain("filter not found");
    });

    it("delete_filter 성공", async () => {
      const store = make_store({ delete_filter: vi.fn().mockResolvedValue(true) });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "delete_filter", filter_id: "f1" });
      expect(r).toContain("filter deleted");
    });
  });

  /* ═══════════════════════════════════════════
   * set_rule_executor
   * ═══════════════════════════════════════════ */

  describe("set_rule_executor", () => {
    it("set 후 add_rule 시 watch 호출됨", async () => {
      const watch = vi.fn();
      const store = make_store({
        add_rule: vi.fn().mockResolvedValue({
          rule_id: "R1", board_id: "B1", trigger: "card_moved", action_type: "comment",
          condition: {}, action_params: {}, enabled: true,
        }),
      });
      const tool = new KanbanTool(store);
      tool.set_rule_executor({ watch } as any);
      await tool.execute({ action: "add_rule", board_id: "B1", trigger: "card_moved", action_type: "comment" });
      expect(watch).toHaveBeenCalledWith("B1");
    });
  });

  /* ═══════════════════════════════════════════
   * 에러 핸들링
   * ═══════════════════════════════════════════ */

  describe("에러 핸들링", () => {
    it("unknown action → Error", async () => {
      const tool = new KanbanTool(make_store());
      const result = await tool.execute({ action: "nonexistent" }, ctx);
      expect(result).toContain("Error");
      expect(result).toContain("unknown action");
    });

    it("store 예외 → Error 메시지 (create_board)", async () => {
      const store = make_store({
        create_board: vi.fn().mockRejectedValue(new Error("db locked")),
      });
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_board", name: "X", scope_type: "channel", scope_id: "x" }, ctx);
      expect(result).toContain("Error");
      expect(result).toContain("db locked");
    });

    it("store 예외 → Error 메시지 (DB 연결 실패)", async () => {
      const store = make_store({
        create_board: vi.fn().mockRejectedValue(new Error("DB 연결 실패")),
      });
      const tool = new KanbanTool(store);
      const r = await tool.execute({ action: "create_board", name: "테스트", scope_type: "channel", scope_id: "ch1" });
      expect(r).toContain("Error: DB 연결 실패");
    });
  });
});
