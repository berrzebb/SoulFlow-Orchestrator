import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";
import type { KanbanStoreLike, KanbanBoard, KanbanCard, KanbanComment, KanbanRelation, BoardSummary } from "@src/services/kanban-store.js";

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

function make_mock_store(): KanbanStoreLike {
  return {
    create_board: vi.fn().mockResolvedValue(make_board()),
    get_board: vi.fn().mockResolvedValue(make_board()),
    list_boards: vi.fn().mockResolvedValue([make_board()]),
    update_board: vi.fn().mockResolvedValue(make_board()),
    delete_board: vi.fn().mockResolvedValue(true),
    create_card: vi.fn().mockResolvedValue(make_card()),
    get_card: vi.fn().mockResolvedValue(make_card()),
    list_cards: vi.fn().mockResolvedValue([make_card()]),
    move_card: vi.fn().mockResolvedValue(make_card({ column_id: "done" })),
    update_card: vi.fn().mockResolvedValue(make_card({ title: "Updated" })),
    delete_card: vi.fn().mockResolvedValue(true),
    add_comment: vi.fn().mockResolvedValue({ comment_id: "c-1", card_id: "TB-1", author: "agent", text: "hi", created_at: "2026-01-01" } satisfies KanbanComment),
    list_comments: vi.fn().mockResolvedValue([]),
    add_relation: vi.fn().mockResolvedValue({ relation_id: "r-1", source_card_id: "TB-1", target_card_id: "TB-2", type: "blocked_by" } satisfies KanbanRelation),
    remove_relation: vi.fn().mockResolvedValue(true),
    list_relations: vi.fn().mockResolvedValue([]),
    get_card_by_readable_id: vi.fn().mockResolvedValue(make_card()),
    board_summary: vi.fn().mockResolvedValue({
      board_id: "b-1", name: "Test Board",
      columns: [{ id: "todo", name: "TODO", color: "#95a5a6", count: 2 }],
      total: 2, done: 0, blockers: [],
    } satisfies BoardSummary),
    get_subtasks: vi.fn().mockResolvedValue([]),
    get_participants: vi.fn().mockResolvedValue(["agent"]),
  };
}

describe("KanbanTool", () => {
  const ctx = { sender_id: "agent" };

  it("name과 category", () => {
    const tool = new KanbanTool(make_mock_store());
    expect(tool.name).toBe("kanban");
    expect(tool.category).toBe("admin");
  });

  describe("보드 액션", () => {
    it("create_board", async () => {
      const store = make_mock_store();
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_board", name: "Sprint", scope_type: "channel", scope_id: "ch1" }, ctx);
      expect(result).toContain("ok");
      expect(store.create_board).toHaveBeenCalled();
    });

    it("create_board — name 누락 시 에러", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "create_board" }, ctx);
      expect(result).toContain("Error");
    });

    it("list_boards", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "list_boards" }, ctx);
      expect(result).toContain("Test Board");
    });

    it("list_boards — 빈 목록", async () => {
      const store = make_mock_store();
      (store.list_boards as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "list_boards" }, ctx);
      expect(result).toContain("보드 없음");
    });
  });

  describe("카드 액션", () => {
    it("create_card", async () => {
      const store = make_mock_store();
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_card", board_id: "b-1", title: "New" }, ctx);
      expect(result).toContain("TB-1");
      expect(result).toContain("created");
    });

    it("create_card — 필수 파라미터 누락", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "create_card" }, ctx);
      expect(result).toContain("Error");
    });

    it("move_card", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "move_card", card_id: "TB-1", column_id: "done" }, ctx);
      expect(result).toContain("moved");
    });

    it("move_card — 없는 카드", async () => {
      const store = make_mock_store();
      (store.move_card as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "move_card", card_id: "NOPE-1", column_id: "done" }, ctx);
      expect(result).toContain("Error");
    });

    it("update_card", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "update_card", card_id: "TB-1", title: "Updated" }, ctx);
      expect(result).toContain("updated");
    });

    it("archive_card", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "archive_card", card_id: "TB-1" }, ctx);
      expect(result).toContain("archived");
    });

    it("list_cards", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "list_cards", board_id: "b-1" }, ctx);
      expect(result).toContain("TB-1");
    });

    it("get_card", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "get_card", card_id: "TB-1" }, ctx);
      expect(result).toContain("Task 1");
    });

    it("board_summary", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "board_summary", board_id: "b-1" }, ctx);
      expect(result).toContain("Test Board");
      expect(result).toContain("0/2");
    });
  });

  describe("코멘트 액션", () => {
    it("comment", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "comment", card_id: "TB-1", text: "hello" }, ctx);
      expect(result).toContain("comment added");
    });

    it("comment — 필수 파라미터 누락", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "comment", card_id: "TB-1" }, ctx);
      expect(result).toContain("Error");
    });

    it("list_comments — 빈 목록", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "list_comments", card_id: "TB-1" }, ctx);
      expect(result).toContain("코멘트 없음");
    });
  });

  describe("관계 액션", () => {
    it("add_relation", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({
        action: "add_relation", source_card_id: "TB-1", target_card_id: "TB-2", type: "blocked_by",
      }, ctx);
      expect(result).toContain("relation added");
    });

    it("remove_relation", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "remove_relation", relation_id: "r-1" }, ctx);
      expect(result).toContain("relation removed");
    });

    it("remove_relation — 없는 관계", async () => {
      const store = make_mock_store();
      (store.remove_relation as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "remove_relation", relation_id: "nope" }, ctx);
      expect(result).toContain("Error");
    });
  });

  describe("에러 핸들링", () => {
    it("unknown action", async () => {
      const tool = new KanbanTool(make_mock_store());
      const result = await tool.execute({ action: "nonexistent" }, ctx);
      expect(result).toContain("Error");
      expect(result).toContain("unknown action");
    });

    it("store 예외 → Error 메시지", async () => {
      const store = make_mock_store();
      (store.create_board as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db locked"));
      const tool = new KanbanTool(store);
      const result = await tool.execute({ action: "create_board", name: "X", scope_type: "channel", scope_id: "x" }, ctx);
      expect(result).toContain("Error");
      expect(result).toContain("db locked");
    });
  });
});
