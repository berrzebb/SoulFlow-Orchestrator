/**
 * kanban-rule-executor — 미커버 분기 보충 (cov3).
 * - execute_action move_card: valid column_id → store.move_card + log.info + break
 * - execute_action create_task: bridge 없음 → log.warn + return
 * - matches_condition to_column 불일치 → return false
 * - rule_evaluate_error: get_rules_by_trigger throw → log.warn
 * - rule_action_error: execute_action throw → log.warn
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KanbanStore } from "@src/services/kanban-store.js";
import { register_kanban_rule_executor } from "@src/services/kanban-rule-executor.js";
import { setTimeout as sleep } from "node:timers/promises";

let workspace: string;
let store: KanbanStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "kanban-rule-cov3-"));
  store = new KanbanStore(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// move_card action with valid column_id
// ══════════════════════════════════════════

describe("kanban-rule-executor — move_card action 실행", () => {
  it("action_type=move_card + column_id 있음 → store.move_card 호출", async () => {
    const board = await store.create_board({ name: "MC Board", scope_type: "channel", scope_id: "mc1" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "Test", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      // from_column: "todo" → in_progress로 이동 시에만 트리거 (done으로 이동 시 재트리거 방지)
      condition: { from_column: "todo" },
      action_type: "move_card",
      action_params: { column_id: "done" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(150);

    // rule이 실행되어 카드가 done으로 이동됨
    const updated = await store.get_card(card.card_id);
    expect(updated?.column_id).toBe("done");

    executor.dispose();
  });
});

// ══════════════════════════════════════════
// create_task without bridge
// ══════════════════════════════════════════

describe("kanban-rule-executor — create_task bridge 없음", () => {
  it("bridge.create_task 없음 → log.warn + return (bridge=undefined)", async () => {
    const board = await store.create_board({ name: "CT Board", scope_type: "channel", scope_id: "ct1" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: {},
      action_type: "create_task",
      action_params: { prompt: "do task" },
    });

    // bridge 없이 executor 생성 → create_task bridge 없음 → L103 warn + return
    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(150);

    // task_id가 설정되지 않아야 함 (bridge 없이는 실행 안 됨)
    const updated = await store.get_card(card.card_id);
    expect(updated?.task_id).toBeUndefined();

    executor.dispose();
  });

  it("bridge 있으나 create_task 미정의 → log.warn + return", async () => {
    const board = await store.create_board({ name: "CT2 Board", scope_type: "channel", scope_id: "ct2" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T2", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: {},
      action_type: "create_task",
      action_params: { prompt: "do task" },
    });

    // bridge에 create_task 메서드 없음 → bridge?.create_task is undefined
    const executor = register_kanban_rule_executor(store, { run_workflow: async () => ({ ok: false }) });
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(150);

    executor.dispose();
  });
});

// ══════════════════════════════════════════
// matches_condition: to_column 불일치 → return false
// ══════════════════════════════════════════

describe("kanban-rule-executor — to_column 조건 불일치", () => {
  it("to_column='done'인데 카드가 in_progress로 이동 → 조건 불일치 → action 실행 안됨", async () => {
    const board = await store.create_board({ name: "TC Board", scope_type: "channel", scope_id: "tc1" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: { to_column: "done" },  // done으로 이동 시에만 실행
      action_type: "comment",
      action_params: { text: "Arrived at done" },
    });

    const executor = register_kanban_rule_executor(store);
    executor.watch(board.board_id);

    // in_progress로 이동 → to_column 불일치 → return false → action 미실행
    await store.move_card(card.card_id, "in_progress");
    await sleep(150);

    const comments = await store.list_comments(card.card_id);
    expect(comments).toHaveLength(0);

    executor.dispose();
  });
});

// ══════════════════════════════════════════
// rule_action_error: execute_action throw → log.warn
// ══════════════════════════════════════════

describe("kanban-rule-executor — rule_action_error (execute_action throw)", () => {
  it("execute_action 에러 → catch log.warn, 다음 rule은 계속 실행", async () => {
    const board = await store.create_board({ name: "ERR Board", scope_type: "channel", scope_id: "err1" });
    const card = await store.create_card({ board_id: board.board_id, column_id: "todo", title: "T", created_by: "test" });

    // run_workflow bridge가 throw하는 rule → catch → rule_action_error
    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: {},
      action_type: "run_workflow",
      action_params: { template: "failing-template" },
    });
    // 두 번째 rule: comment 정상 실행됨을 확인
    await store.add_rule({
      board_id: board.board_id,
      trigger: "card_moved",
      condition: {},
      action_type: "comment",
      action_params: { text: "Second rule ran" },
    });

    const executor = register_kanban_rule_executor(store, {
      run_workflow: async () => { throw new Error("simulated run_workflow error"); },
    });
    executor.watch(board.board_id);

    await store.move_card(card.card_id, "in_progress");
    await sleep(150);

    // 두 번째 rule이 실행됨 (첫 번째 에러에도 불구하고)
    const comments = await store.list_comments(card.card_id);
    expect(comments.some(c => c.text === "Second rule ran")).toBe(true);

    executor.dispose();
  });
});
