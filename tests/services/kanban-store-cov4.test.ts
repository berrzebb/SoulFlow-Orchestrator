/**
 * KanbanStore — 미커버 분기 (cov4):
 * - L291: parse_json_safe catch — 잘못된 JSON → fallback 반환
 * - L663, L686, L687, L691: create_card — board 없음 → 예외 전파
 * - L774: update_card — title 업데이트 분기
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { KanbanStore, type KanbanStoreLike } from "@src/services/kanban-store.js";

describe("KanbanStore — cov4", () => {
  let dir: string;
  let store: KanbanStoreLike;
  let board_id: string;
  let card_id: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kanban-cov4-"));
    store = new KanbanStore(dir);
    const board = await store.create_board({ name: "Cov4 Board", scope_type: "channel", scope_id: "cov4-ch" });
    board_id = board.board_id;
    const card = await store.create_card({ board_id, title: "Initial Title", created_by: "tester" });
    card_id = card.card_id;
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ── L291: parse_json_safe catch — 잘못된 JSON ────────────────────────────────

  describe("parse_json_safe — L291: 잘못된 JSON → fallback 반환", () => {
    it("columns_json 손상 → get_board에서 parse_json_safe catch → 빈 배열 반환 (L291)", async () => {
      const db_path = (store as any).sqlite_path as string;

      // columns_json을 잘못된 JSON으로 직접 업데이트
      const db = new DatabaseSync(db_path);
      try {
        db.prepare("UPDATE kanban_boards SET columns_json = ? WHERE board_id = ?")
          .run("{invalid json", board_id);
      } finally {
        db.close();
      }

      // get_board → row_to_board → parse_json_safe("{invalid json", []) → catch → []
      const board = await store.get_board(board_id);
      expect(board).not.toBeNull();
      // parse_json_safe catches → fallback = []
      expect(Array.isArray(board?.columns)).toBe(true);
      // 정상이라면 DEFAULT_COLUMNS이 있어야 하지만 잘못된 JSON → []
      expect(board?.columns).toHaveLength(0);
    });
  });

  // ── L663, L686, L687, L691: create_card — board 없음 ─────────────────────────

  describe("create_card — L663/L686/L687/L691: board 없음 → 예외", () => {
    it("존재하지 않는 board_id → board_not_found throw → ROLLBACK → 재throw → L691 throw", async () => {
      await expect(
        store.create_card({ board_id: "nonexistent-board-id", title: "Test", created_by: "user" }),
      ).rejects.toThrow();
      // L663: board not found → throw
      // L686: ROLLBACK
      // L687: rethrow
      // with_sqlite catches → null
      // L691: if (!result) throw new Error("create_card_failed")
    });
  });

  // ── L774: update_card — title 업데이트 ───────────────────────────────────────

  describe("update_card — L774: title 업데이트 분기", () => {
    it("title 업데이트 → L774: sets.push('title = ?') 실행", async () => {
      const updated = await store.update_card(card_id, { title: "Updated Title", actor: "tester" });
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("Updated Title");
    });
  });
});
