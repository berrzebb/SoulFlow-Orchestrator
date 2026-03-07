import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { KanbanStore, type KanbanStoreLike } from "@src/services/kanban-store.js";

describe("KanbanStore", () => {
  let dir: string;
  let store: KanbanStoreLike;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kanban-test-"));
    store = new KanbanStore(dir);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /* ─── Board ─── */

  describe("Board CRUD", () => {
    it("보드 생성 → 기본 컬럼 4개", async () => {
      const board = await store.create_board({ name: "Sprint Board", scope_type: "channel", scope_id: "ch1" });
      expect(board.board_id).toBeTruthy();
      expect(board.prefix).toBe("SB");
      expect(board.columns).toHaveLength(4);
      expect(board.columns.map(c => c.id)).toEqual(["todo", "in_progress", "in_review", "done"]);
      expect(board.next_seq).toBe(1);
    });

    it("보드 조회", async () => {
      const board = await store.create_board({ name: "Dev Board", scope_type: "session", scope_id: "s1" });
      const found = await store.get_board(board.board_id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Dev Board");
    });

    it("보드 목록 — scope 필터", async () => {
      const all = await store.list_boards();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const session_only = await store.list_boards("session");
      expect(session_only.every(b => b.scope_type === "session")).toBe(true);
    });

    it("보드 업데이트", async () => {
      const board = await store.create_board({ name: "Old Name", scope_type: "workflow", scope_id: "w1" });
      const updated = await store.update_board(board.board_id, { name: "New Name" });
      expect(updated!.name).toBe("New Name");
    });

    it("보드 삭제", async () => {
      const board = await store.create_board({ name: "ToDelete", scope_type: "channel", scope_id: "del1" });
      expect(await store.delete_board(board.board_id)).toBe(true);
      expect(await store.get_board(board.board_id)).toBeNull();
    });

    it("없는 보드 삭제 → false", async () => {
      expect(await store.delete_board("nonexistent")).toBe(false);
    });
  });

  /* ─── Card ─── */

  describe("Card CRUD", () => {
    let board_id: string;
    let prefix: string;

    beforeAll(async () => {
      const board = await store.create_board({ name: "Card Test", scope_type: "channel", scope_id: "card-ch" });
      board_id = board.board_id;
      prefix = board.prefix;
    });

    it("카드 생성 → prefix-seq 형태 card_id", async () => {
      const card = await store.create_card({ board_id, title: "Task 1", created_by: "agent" });
      expect(card.card_id).toBe(`${prefix}-1`);
      expect(card.column_id).toBe("todo");
      expect(card.priority).toBe("none");
      expect(card.comment_count).toBe(0);
    });

    it("두번째 카드 → seq 증가", async () => {
      const card = await store.create_card({ board_id, title: "Task 2", created_by: "agent" });
      expect(card.card_id).toBe(`${prefix}-2`);
    });

    it("카드 조회", async () => {
      const card = await store.create_card({ board_id, title: "Lookup", created_by: "agent" });
      const found = await store.get_card(card.card_id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe("Lookup");
    });

    it("카드 이동", async () => {
      const card = await store.create_card({ board_id, title: "Move Me", created_by: "agent" });
      const moved = await store.move_card(card.card_id, "in_progress");
      expect(moved!.column_id).toBe("in_progress");
    });

    it("카드 업데이트 — 제목, 우선순위, 라벨", async () => {
      const card = await store.create_card({ board_id, title: "Original", created_by: "agent" });
      const updated = await store.update_card(card.card_id, {
        title: "Updated",
        priority: "high",
        labels: ["bug:#e74c3c"],
      });
      expect(updated!.title).toBe("Updated");
      expect(updated!.priority).toBe("high");
      expect(updated!.labels).toEqual(["bug:#e74c3c"]);
    });

    it("카드 삭제 (아카이브)", async () => {
      const card = await store.create_card({ board_id, title: "ToArchive", created_by: "agent" });
      expect(await store.delete_card(card.card_id)).toBe(true);
      expect(await store.get_card(card.card_id)).toBeNull();
    });

    it("없는 카드 이동 → null", async () => {
      expect(await store.move_card("NOPE-999", "done")).toBeNull();
    });

    it("카드 목록 — column 필터", async () => {
      await store.create_card({ board_id, title: "In Todo", created_by: "agent", column_id: "todo" });
      const todos = await store.list_cards(board_id, "todo");
      expect(todos.every(c => c.column_id === "todo")).toBe(true);
    });

    it("카드 목록 — assignee 필터", async () => {
      await store.create_card({ board_id, title: "My Task", created_by: "agent", assignee: "user-1" });
      const mine = await store.list_cards(board_id, undefined, undefined, "user-1");
      expect(mine.every(c => c.assignee === "user-1")).toBe(true);
      expect(mine.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ─── Subtask ─── */

  describe("서브태스크 (parent_id)", () => {
    it("parent_id로 생성 → parent_of/child_of 관계 자동 생성", async () => {
      const board = await store.create_board({ name: "Sub Test", scope_type: "channel", scope_id: "sub-ch" });
      const parent = await store.create_card({ board_id: board.board_id, title: "Parent", created_by: "agent" });
      const child = await store.create_card({ board_id: board.board_id, title: "Child", created_by: "agent", parent_id: parent.card_id });

      const subtasks = await store.get_subtasks(parent.card_id);
      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].card_id).toBe(child.card_id);

      const relations = await store.list_relations(parent.card_id);
      expect(relations.some(r => r.type === "parent_of")).toBe(true);
    });
  });

  /* ─── Comment ─── */

  describe("코멘트", () => {
    let cmt_store: KanbanStoreLike;
    let cmt_dir: string;
    let cmt_board_id: string;

    beforeAll(async () => {
      cmt_dir = await mkdtemp(join(tmpdir(), "kanban-cmt-"));
      cmt_store = new KanbanStore(cmt_dir);
      const board = await cmt_store.create_board({ name: "Comment Test", scope_type: "channel", scope_id: "cmt-ch" });
      cmt_board_id = board.board_id;
      // 보드가 실제로 DB에 저장되었는지 확인
      const found = await cmt_store.get_board(cmt_board_id);
      expect(found).not.toBeNull();
    });

    afterAll(async () => {
      if (cmt_dir) await rm(cmt_dir, { recursive: true, force: true });
    });

    it("코멘트 추가 + 목록 조회", async () => {
      const card = await cmt_store.create_card({ board_id: cmt_board_id, title: "Commented", created_by: "agent" });

      await cmt_store.add_comment(card.card_id, "user-a", "첫 코멘트");
      await cmt_store.add_comment(card.card_id, "agent", "두번째");

      const comments = await cmt_store.list_comments(card.card_id);
      expect(comments).toHaveLength(2);
      expect(comments[0].text).toBe("첫 코멘트");

      // comment_count 반영 확인
      const refreshed = await cmt_store.get_card(card.card_id);
      expect(refreshed!.comment_count).toBe(2);
    });

    it("limit 적용", async () => {
      const card = await cmt_store.create_card({ board_id: cmt_board_id, title: "Many Comments", created_by: "agent" });
      for (let i = 0; i < 5; i++) await cmt_store.add_comment(card.card_id, "agent", `comment ${i}`);
      const limited = await cmt_store.list_comments(card.card_id, 2);
      expect(limited).toHaveLength(2);
    });
  });

  /* ─── Relation ─── */

  describe("관계", () => {
    it("관계 추가 + 조회 + 삭제", async () => {
      const board = await store.create_board({ name: "Rel Test", scope_type: "channel", scope_id: "rel-ch" });
      const a = await store.create_card({ board_id: board.board_id, title: "A", created_by: "agent" });
      const b = await store.create_card({ board_id: board.board_id, title: "B", created_by: "agent" });

      const rel = await store.add_relation(a.card_id, b.card_id, "blocked_by");
      expect(rel.type).toBe("blocked_by");

      const rels = await store.list_relations(a.card_id);
      expect(rels).toHaveLength(1);
      expect(rels[0].target_card_id).toBe(b.card_id);

      expect(await store.remove_relation(rel.relation_id)).toBe(true);
      expect(await store.list_relations(a.card_id)).toHaveLength(0);
    });

    it("없는 관계 삭제 → false", async () => {
      expect(await store.remove_relation("nonexistent")).toBe(false);
    });
  });

  /* ─── Board Summary ─── */

  describe("보드 요약", () => {
    it("컬럼별 카드 수 + blocker 정보", async () => {
      const board = await store.create_board({ name: "Summary", scope_type: "channel", scope_id: "sum-ch" });
      const c1 = await store.create_card({ board_id: board.board_id, title: "C1", created_by: "agent" });
      const c2 = await store.create_card({ board_id: board.board_id, title: "C2", created_by: "agent" });
      await store.move_card(c2.card_id, "done");
      await store.add_relation(c1.card_id, c2.card_id, "blocked_by");

      const summary = await store.board_summary(board.board_id);
      expect(summary).not.toBeNull();
      expect(summary!.total).toBe(2);
      expect(summary!.done).toBe(1);
      expect(summary!.blockers).toHaveLength(1);
      expect(summary!.blockers[0].card_id).toBe(c1.card_id);
    });

    it("없는 보드 → null", async () => {
      expect(await store.board_summary("nonexistent")).toBeNull();
    });
  });

  /* ─── Participants ─── */

  describe("참여자", () => {
    it("생성자 + 담당자 + 코멘트 작성자 수집", async () => {
      const board = await store.create_board({ name: "Part Test", scope_type: "channel", scope_id: "part-ch" });
      const card = await store.create_card({ board_id: board.board_id, title: "P", created_by: "creator", assignee: "assignee" });
      await store.add_comment(card.card_id, "commenter", "hello");

      const participants = await store.get_participants(card.card_id);
      expect(participants).toContain("creator");
      expect(participants).toContain("assignee");
      expect(participants).toContain("commenter");
    });
  });
});
