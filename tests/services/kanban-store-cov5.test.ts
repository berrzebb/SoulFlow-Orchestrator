/**
 * KanbanStore — 미커버 분기 (cov5):
 * - L774: update_card → description 필드 업데이트
 * - L936: board_summary → this.db 두 번째 호출 null → if (!result) return null
 * - L1152: get_board_metrics → this.db 두 번째 호출 null → if (!result) return null
 *
 * L755-756 (ROLLBACK catch) 및 L221 (hour > 23) 은 defensive dead code:
 * - L755-756: with_sqlite 에러 catch 후 재throw — 실제 트랜잭션 에러는 외부로 전파됨
 * - L221: L219-L220 이후 hour > 23 은 arithmetic 상 불가
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { KanbanStore, type KanbanStoreLike } from "@src/services/kanban-store.js";

describe("KanbanStore — cov5", () => {
  let dir: string;
  let store: KanbanStoreLike;
  let board_id: string;
  let card_id: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kanban-cov5-"));
    store = new KanbanStore(dir);
    const board = await store.create_board({ name: "Cov5 Board", scope_type: "channel", scope_id: "cov5-ch" });
    board_id = board.board_id;
    const card = await store.create_card({ board_id, title: "Cov5 Card", created_by: "tester" });
    card_id = card.card_id;
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ── L774: update_card description 필드 ──────────────────────────────────────

  describe("update_card — L774: description 필드 업데이트", () => {
    it("description 업데이트 → L774: sets.push('description = ?') 실행", async () => {
      const updated = await store.update_card(card_id, { description: "새 설명 텍스트" });
      expect(updated).not.toBeNull();
      // 업데이트된 카드에 description 반영
    });
  });

  // ── L936: board_summary → this.db null (두 번째 호출) ───────────────────────

  describe("board_summary — L936: db null → if (!result) return null", () => {
    it("this.db 두 번째 호출 null 반환 → L936: if (!result) return null", async () => {
      // get_board(첫 번째 db 호출)은 성공, 그 다음 board_summary의 db 호출은 null 반환
      const raw_store = store as any;
      const original_db = raw_store.db.bind(raw_store);
      let call_count = 0;
      raw_store.db = (fn: any) => {
        call_count++;
        if (call_count === 1) return original_db(fn); // get_board 성공
        raw_store.db = original_db.bind(raw_store);   // 복원
        return null;                                    // board_summary 자체 쿼리 → null
      };

      const result = await store.board_summary(board_id);
      // L936: if (!result) return null → null 반환
      expect(result).toBeNull();
    });
  });

  // ── L1152: get_board_metrics → this.db null (두 번째 호출) ──────────────────

  describe("get_board_metrics — L1152: db null → if (!result) return null", () => {
    it("this.db 두 번째 호출 null 반환 → L1152: if (!result) return null", async () => {
      const raw_store = store as any;
      const original_db = raw_store.db.bind(raw_store);
      let call_count = 0;
      raw_store.db = (fn: any) => {
        call_count++;
        if (call_count === 1) return original_db(fn); // get_board 성공
        raw_store.db = original_db.bind(raw_store);   // 복원
        return null;                                    // get_board_metrics 자체 쿼리 → null
      };

      const result = await store.get_board_metrics(board_id);
      // L1152: if (!result) return null
      expect(result).toBeNull();
    });
  });
});
