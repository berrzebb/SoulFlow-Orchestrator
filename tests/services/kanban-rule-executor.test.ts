import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KanbanStore } from "@src/services/kanban-store.js";
import { register_kanban_rule_executor, setup_kanban_rule_listeners } from "@src/services/kanban-rule-executor.js";
import { setTimeout as sleep } from "node:timers/promises";

let workspace: string;
let store: KanbanStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kanban-rule-exec-"));
  store = new KanbanStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// 기본 컬럼: todo, in_progress, in_review, done

describe("kanban rule executor", () => {
  it("card_moved trigger로 move_card action이 실행된다", async () => {
    const board = await store.create_board({ name: "Test Board", scope_type: "channel", scope_id: "ws1" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Task 1", created_by: "test" });

    // rule: "done" 컬럼으로 이동하면 자동으로 comment 추가
    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "done" },
      action_type: "comment",
      action_params: { text: "Auto-closed!" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    // 카드를 done으로 이동 → rule 매칭 → comment 추가
    await store.move_card(card.card_id, "done");
    await sleep(100);

    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(1);
    expect(comments[0]!.text).toBe("Auto-closed!");

    executor.dispose();
  });

  it("condition이 맞지 않으면 action이 실행되지 않는다", async () => {
    const board = await store.create_board({ name: "Board 2", scope_type: "channel", scope_id: "ws2" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Task 2", created_by: "test" });

    // rule: "done" 컬럼으로 이동할 때만 트리거
    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "done" },
      action_type: "comment",
      action_params: { text: "Done!" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    // in_progress로 이동 — condition 불일치 → action 없음
    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(0);

    executor.dispose();
  });

  it("run_workflow bridge가 주입되면 run_workflow action이 실행된다", async () => {
    const board = await store.create_board({ name: "Bridge Board", scope_type: "workflow", scope_id: "ws-bridge" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Deploy", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "in_review" },
      action_type: "run_workflow",
      action_params: { template: "deploy-pipeline", title: "Auto Deploy" },
    });

    const calls: unknown[] = [];
    const executor = register_kanban_rule_executor(store, {
      async run_workflow(params) {
        calls.push(params);
        return { ok: true, workflow_id: "wf-test-123" };
      },
    });
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_review");
    await sleep(100);

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ template: "deploy-pipeline", title: "Auto Deploy" });
    // bridge 성공 시 자동 코멘트도 추가됨
    const comments = await store.list_comments(card.card_id);
    expect(comments.some(c => c.text.includes("wf-test-123"))).toBe(true);

    executor.dispose();
  });

  it("create_task bridge가 주입되면 create_task action이 실행된다", async () => {
    const board = await store.create_board({ name: "Task Board", scope_type: "workflow", scope_id: "ws-task" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Review PR", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "in_progress" },
      action_type: "create_task",
      action_params: { prompt: "Review the PR" },
    });

    const calls: unknown[] = [];
    const executor = register_kanban_rule_executor(store, {
      async create_task(params) {
        calls.push(params);
        return { ok: true, task_id: "task-abc" };
      },
    });
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ prompt: "Review the PR" });
    // task_id가 카드에 링크됨
    const updated = await store.get_card(card.card_id);
    expect(updated?.task_id).toBe("task-abc");

    executor.dispose();
  });

  it("bridge 없이 run_workflow action은 스킵된다", async () => {
    const board = await store.create_board({ name: "No Bridge", scope_type: "workflow", scope_id: "ws-nobridge" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Skip", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "done" },
      action_type: "run_workflow",
      action_params: { template: "test" },
    });

    // bridge 없이 생성
    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "done");
    await sleep(100);

    // bridge 미주입이므로 코멘트 없음 (스킵)
    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(0);

    executor.dispose();
  });

  it("watch 중복 호출은 무시된다 (board_listeners.has guard)", async () => {
    const board = await store.create_board({ name: "Watch Board", scope_type: "channel", scope_id: "ws-watch" });
    await store.add_rule({
      board_id: board.board_id, trigger: "card_moved", condition: { to_column: "done" },
      action_type: "comment", action_params: { text: "OK" },
    });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);
    executor.watch(board.board_id); // 두 번째 호출 → noop

    await store.move_card(card.card_id, "done");
    await sleep(100);

    // 중복 리스너가 없어서 comment가 1번만 추가되어야 함
    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(1);
    executor.dispose();
  });

  it("move_card action — target_column 없으면 스킵", async () => {
    const board = await store.create_board({ name: "Move Board", scope_type: "channel", scope_id: "ws-move" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    // column_id 없는 move_card rule → 스킵
    await store.add_rule({
      board_id: board.board_id, trigger: "card_moved", condition: {},
      action_type: "move_card", action_params: {}, // column_id 없음
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);
    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    // 에러 없이 스킵
    const c = await store.get_card(card.card_id);
    expect(c?.column_id).toBe("in_progress");
    executor.dispose();
  });

  it("assign action — assignee 있으면 카드 업데이트", async () => {
    const board = await store.create_board({ name: "Assign Board", scope_type: "channel", scope_id: "ws-assign" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id, trigger: "card_moved", condition: {},
      action_type: "assign", action_params: { assignee: "alice" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);
    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    const updated = await store.get_card(card.card_id);
    expect(updated?.assignee).toBe("alice");
    executor.dispose();
  });

  it("add_label action — 라벨 추가됨", async () => {
    const board = await store.create_board({ name: "Label Board", scope_type: "channel", scope_id: "ws-label" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id, trigger: "card_moved", condition: {},
      action_type: "add_label", action_params: { label: "urgent" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);
    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    const updated = await store.get_card(card.card_id);
    expect(updated?.labels ?? []).toContain("urgent");
    executor.dispose();
  });

  it("matches_condition — from_column 조건 필터링", async () => {
    const board = await store.create_board({ name: "From Board", scope_type: "channel", scope_id: "ws-from" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    // "todo"에서 이동할 때만 comment
    await store.add_rule({
      board_id: board.board_id, trigger: "card_moved",
      condition: { from_column: "todo" },
      action_type: "comment", action_params: { text: "From todo" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);
    await store.move_card(card.card_id, "in_progress"); // from: todo → 매칭
    await sleep(100);

    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(1);
    executor.dispose();
  });

  it("setup_kanban_rule_listeners — 활성 rule이 있는 보드만 watch", async () => {
    const board1 = await store.create_board({ name: "Active Board", scope_type: "channel", scope_id: "ws-active" });
    await store.add_rule({
      board_id: board1.board_id, trigger: "card_moved", condition: {},
      action_type: "comment", action_params: { text: "Triggered" },
    });

    const board2 = await store.create_board({ name: "Inactive Board", scope_type: "channel", scope_id: "ws-inactive" });
    const disabledRule = await store.add_rule({
      board_id: board2.board_id, trigger: "card_moved", condition: {},
      action_type: "comment", action_params: { text: "Nope" },
    });
    await store.update_rule(disabledRule.rule_id, { enabled: false });

    const executor = await setup_kanban_rule_listeners(store);

    // board1에 카드 추가 후 이동 → comment 추가되어야 함
    const card = await store.create_card({ board_id: board1.board_id, column_id: "todo", title: "C", created_by: "test" });
    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(1);
    executor.dispose();
  });

  it("disabled rule은 실행되지 않는다", async () => {
    const board = await store.create_board({ name: "Board 3", scope_type: "channel", scope_id: "ws3" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Task 3", created_by: "test" });

    const rule = await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: {},
      action_type: "comment",
      action_params: { text: "Moved!" },
    });

    // rule 비활성화
    await store.update_rule(rule.rule_id, { enabled: false });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(100);

    const comments = await store.list_comments(card.card_id);
    expect(comments.length).toBe(0);

    executor.dispose();
  });
});
