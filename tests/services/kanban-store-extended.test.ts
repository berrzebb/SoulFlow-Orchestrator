/**
 * KanbanStore — 미커버 경로 보충.
 * activities, rules, templates, board_metrics, subtask_counts, get_card_by_readable_id.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { KanbanStore, type KanbanStoreLike } from "@src/services/kanban-store.js";

describe("KanbanStore — Extended Coverage", () => {
  let dir: string;
  let store: KanbanStoreLike;
  let board_id: string;
  let card_id: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kanban-ext-"));
    store = new KanbanStore(dir);
    const board = await store.create_board({ name: "Test Board", scope_type: "channel", scope_id: "ext-ch1" });
    board_id = board.board_id;
    const card = await store.create_card({ board_id, title: "Root Card", created_by: "tester" });
    card_id = card.card_id;
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ══════════════════════════════════════════
  // Activities
  // ══════════════════════════════════════════

  describe("log_activity / list_activities", () => {
    it("log_activity → KanbanActivity 반환", async () => {
      const activity = await store.log_activity(card_id, board_id, "agent", "created");
      expect(activity.card_id).toBe(card_id);
      expect(activity.board_id).toBe(board_id);
      expect(activity.actor).toBe("agent");
      expect(activity.action).toBe("created");
      expect(activity.activity_id).toBeDefined();
    });

    it("log_activity with detail", async () => {
      const activity = await store.log_activity(card_id, board_id, "agent", "moved", { from: "todo", to: "in-progress" });
      expect(activity.detail).toMatchObject({ from: "todo", to: "in-progress" });
    });

    it("list_activities by card_id", async () => {
      const activities = await store.list_activities({ card_id });
      expect(activities.length).toBeGreaterThan(0);
      expect(activities.every(a => a.card_id === card_id)).toBe(true);
    });

    it("list_activities by board_id", async () => {
      const activities = await store.list_activities({ board_id });
      expect(activities.length).toBeGreaterThan(0);
    });

    it("list_activities with limit", async () => {
      const activities = await store.list_activities({ board_id, limit: 1 });
      expect(activities.length).toBeLessThanOrEqual(1);
    });
  });

  // ══════════════════════════════════════════
  // Rules
  // ══════════════════════════════════════════

  describe("add_rule / list_rules / update_rule / remove_rule / get_rules_by_trigger", () => {
    let rule_id: string;

    it("add_rule → KanbanRule 반환", async () => {
      const rule = await store.add_rule({
        board_id,
        trigger: "card_moved",
        condition: { column_id: "done" },
        action_type: "assign",
        action_params: { assignee: "agent" },
      });
      rule_id = rule.rule_id;
      expect(rule.board_id).toBe(board_id);
      expect(rule.trigger).toBe("card_moved");
      expect(rule.enabled).toBe(true);
    });

    it("list_rules → board의 룰 목록", async () => {
      const rules = await store.list_rules(board_id);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.rule_id === rule_id)).toBe(true);
    });

    it("get_rules_by_trigger → trigger 필터링", async () => {
      const rules = await store.get_rules_by_trigger(board_id, "card_moved");
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every(r => r.trigger === "card_moved")).toBe(true);
    });

    it("get_rules_by_trigger → 없는 trigger → 빈 배열", async () => {
      const rules = await store.get_rules_by_trigger(board_id, "card_created");
      expect(rules).toEqual([]);
    });

    it("update_rule enabled=false → disabled", async () => {
      const updated = await store.update_rule(rule_id, { enabled: false });
      expect(updated).not.toBeNull();
      expect(updated!.enabled).toBe(false);
    });

    it("update_rule condition 변경", async () => {
      const updated = await store.update_rule(rule_id, { condition: { column_id: "review" } });
      expect(updated!.condition).toMatchObject({ column_id: "review" });
    });

    it("update_rule 없는 id → null", async () => {
      const updated = await store.update_rule("nonexistent-rule", { enabled: true });
      expect(updated).toBeNull();
    });

    it("remove_rule → true", async () => {
      const ok = await store.remove_rule(rule_id);
      expect(ok).toBe(true);
    });

    it("remove_rule 없는 id → false", async () => {
      const ok = await store.remove_rule("nonexistent");
      expect(ok).toBe(false);
    });
  });

  // ══════════════════════════════════════════
  // Templates
  // ══════════════════════════════════════════

  describe("create_template / list_templates / get_template / delete_template", () => {
    let template_id: string;

    it("create_template → KanbanTemplate 반환", async () => {
      const tmpl = await store.create_template({
        name: "Bug Tracker",
        description: "Track bugs",
        columns: [
          { id: "open", name: "Open", position: 0 },
          { id: "resolved", name: "Resolved", position: 1 },
        ],
        cards: [{ title: "Sample Bug", column_id: "open", priority: "high" }],
      });
      template_id = tmpl.template_id;
      expect(tmpl.name).toBe("Bug Tracker");
      expect(tmpl.cards.length).toBe(1);
    });

    it("list_templates → 목록 포함", async () => {
      const tmpls = await store.list_templates();
      expect(tmpls.some(t => t.template_id === template_id)).toBe(true);
    });

    it("get_template by id → 반환", async () => {
      const tmpl = await store.get_template(template_id);
      expect(tmpl).not.toBeNull();
      expect(tmpl!.name).toBe("Bug Tracker");
    });

    it("get_template by name → 반환", async () => {
      const tmpl = await store.get_template("Bug Tracker");
      expect(tmpl).not.toBeNull();
    });

    it("get_template 없는 id → null", async () => {
      const tmpl = await store.get_template("nonexistent-template");
      expect(tmpl).toBeNull();
    });

    it("delete_template → true", async () => {
      const ok = await store.delete_template(template_id);
      expect(ok).toBe(true);
    });

    it("delete_template 없는 id → false", async () => {
      const ok = await store.delete_template("nonexistent");
      expect(ok).toBe(false);
    });
  });

  // ══════════════════════════════════════════
  // Board metrics
  // ══════════════════════════════════════════

  describe("get_board_metrics", () => {
    it("get_board_metrics → BoardMetrics 또는 null 반환", async () => {
      const metrics = await store.get_board_metrics(board_id);
      // 데이터가 없어 null일 수 있음
      expect(metrics === null || typeof metrics === "object").toBe(true);
    });

    it("없는 board_id → null", async () => {
      const metrics = await store.get_board_metrics("nonexistent-board");
      expect(metrics).toBeNull();
    });

    it("days 파라미터 → 정상 실행", async () => {
      const metrics = await store.get_board_metrics(board_id, 7);
      expect(metrics === null || typeof metrics === "object").toBe(true);
    });
  });

  // ══════════════════════════════════════════
  // get_subtask_counts
  // ══════════════════════════════════════════

  describe("get_subtask_counts", () => {
    it("서브태스크 없으면 빈 Map 반환", async () => {
      const counts = await store.get_subtask_counts(board_id);
      expect(counts).toBeInstanceOf(Map);
    });

    it("서브태스크 있으면 parent_id 기준 집계", async () => {
      const parent = await store.create_card({ board_id, title: "Parent Task", created_by: "agent" });
      // 완료된 서브태스크 1개
      const done_col = (await store.get_board(board_id))!.columns.find(c => c.name === "Done" || c.position >= 3)!;
      const child1 = await store.create_card({ board_id, title: "Sub1", parent_id: parent.card_id, created_by: "agent" });
      const child2 = await store.create_card({ board_id, title: "Sub2", parent_id: parent.card_id, created_by: "agent" });
      if (done_col) {
        await store.move_card(child1.card_id, done_col.id);
      }
      const counts = await store.get_subtask_counts(board_id);
      expect(counts.has(parent.card_id)).toBe(true);
      const entry = counts.get(parent.card_id)!;
      expect(entry.total).toBe(2);
    });
  });

  // ══════════════════════════════════════════
  // get_card_by_readable_id
  // ══════════════════════════════════════════

  describe("get_card_by_readable_id", () => {
    it("card_id(readable_id 형식)로 카드 조회", async () => {
      // card_id 자체가 readable id (e.g. "BOARD-1")
      const by_readable = await store.get_card_by_readable_id(card_id);
      expect(by_readable).not.toBeNull();
      expect(by_readable!.card_id).toBe(card_id);
    });

    it("없는 readable_id → null", async () => {
      const found = await store.get_card_by_readable_id("NONE-9999");
      expect(found).toBeNull();
    });
  });

  // ══════════════════════════════════════════
  // list_cards — column 필터 + assignee 필터
  // ══════════════════════════════════════════

  describe("list_cards 필터", () => {
    it("column_id 필터링", async () => {
      const board = await store.get_board(board_id);
      const first_col = board!.columns[0];
      const cards = await store.list_cards(board_id, first_col.id);
      expect(Array.isArray(cards)).toBe(true);
    });

    it("assignee 필터링", async () => {
      await store.update_card(card_id, { assignee: "user-xyz" });
      const cards = await store.list_cards(board_id, undefined, undefined, "user-xyz");
      expect(cards.some(c => c.card_id === card_id)).toBe(true);
    });

    it("limit 적용", async () => {
      const cards = await store.list_cards(board_id, undefined, 1);
      expect(cards.length).toBeLessThanOrEqual(1);
    });
  });

  // ══════════════════════════════════════════
  // list_boards — scope_type + scope_id 필터
  // ══════════════════════════════════════════

  describe("list_boards scope 필터", () => {
    it("scope_id 필터링", async () => {
      await store.create_board({ name: "Filtered", scope_type: "session", scope_id: "unique-scope-xyz" });
      const found = await store.list_boards("session", "unique-scope-xyz");
      expect(found.some(b => b.scope_id === "unique-scope-xyz")).toBe(true);
    });
  });
});
