/** Kanban Rule Runtime Executor — activity 이벤트에 rule을 매칭하여 자동 action 실행. */

import { create_logger } from "../logger.js";
import { error_message } from "../utils/common.js";
import type { KanbanStoreLike, KanbanEvent, KanbanRule, ActivityAction } from "./kanban-store.js";

const log = create_logger("kanban-rule-executor");

/** 외부 실행 브릿지 — workflow/task 자동화용. */
export interface RuleExecutionBridge {
  run_workflow?(params: { template: string; title?: string; objective?: string; channel?: string; chat_id?: string }): Promise<{ ok: boolean; workflow_id?: string; error?: string }>;
  create_task?(params: { prompt: string; channel?: string; chat_id?: string }): Promise<{ ok: boolean; task_id?: string; error?: string }>;
}

const TRIGGER_TO_ACTIONS: Record<KanbanRule["trigger"], ActivityAction[]> = {
  card_moved: ["moved"],
  subtasks_done: ["updated"],
  card_stale: [],
};

function matches_trigger(rule: KanbanRule, action: ActivityAction): boolean {
  const expected = TRIGGER_TO_ACTIONS[rule.trigger];
  return expected.length > 0 && expected.includes(action);
}

function matches_condition(rule: KanbanRule, detail: Record<string, unknown>): boolean {
  const cond = rule.condition;
  if (!cond || Object.keys(cond).length === 0) return true;

  // column filter: condition.to_column matches detail.to
  if (cond.to_column && detail.to !== cond.to_column) return false;
  if (cond.from_column && detail.from !== cond.from_column) return false;

  // label filter
  if (cond.label && !String(detail.labels || "").includes(String(cond.label))) return false;

  return true;
}

async function execute_action(
  store: KanbanStoreLike,
  rule: KanbanRule,
  card_id: string,
  board_id: string,
  bridge?: RuleExecutionBridge,
): Promise<void> {
  const params = rule.action_params;

  switch (rule.action_type) {
    case "move_card": {
      const target_column = String(params.column_id || "");
      if (!target_column) {
        log.warn("rule_action_skip", { rule_id: rule.rule_id, reason: "missing column_id in action_params" });
        return;
      }
      await store.move_card(card_id, target_column);
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "move_card", card_id, target_column });
      break;
    }
    case "assign": {
      const assignee = String(params.assignee || "");
      if (!assignee) return;
      await store.update_card(card_id, { assignee });
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "assign", card_id, assignee });
      break;
    }
    case "add_label": {
      const label = String(params.label || "");
      if (!label) return;
      const card = await store.get_card(card_id);
      if (!card) return;
      const labels = [...new Set([...(card.labels || []), label])];
      await store.update_card(card_id, { labels });
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "add_label", card_id, label });
      break;
    }
    case "comment": {
      const text = String(params.text || "");
      if (!text) return;
      await store.add_comment(card_id, "rule-executor", text);
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "comment", card_id });
      break;
    }
    case "run_workflow": {
      if (!bridge?.run_workflow) {
        log.warn("rule_action_skip", { rule_id: rule.rule_id, reason: "run_workflow bridge unavailable" });
        return;
      }
      const result = await bridge.run_workflow({
        template: String(params.template || ""),
        title: params.title ? String(params.title) : undefined,
        objective: params.objective ? String(params.objective) : undefined,
        channel: params.channel ? String(params.channel) : undefined,
        chat_id: params.chat_id ? String(params.chat_id) : undefined,
      });
      if (result.ok) {
        await store.add_comment(card_id, "rule-executor", `워크플로우 시작: ${result.workflow_id}`);
      }
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "run_workflow", card_id, ok: result.ok, workflow_id: result.workflow_id });
      break;
    }
    case "create_task": {
      if (!bridge?.create_task) {
        log.warn("rule_action_skip", { rule_id: rule.rule_id, reason: "create_task bridge unavailable" });
        return;
      }
      const card = await store.get_card(card_id);
      const prompt = params.prompt ? String(params.prompt) : card?.title ?? "";
      const result = await bridge.create_task({
        prompt,
        channel: params.channel ? String(params.channel) : undefined,
        chat_id: params.chat_id ? String(params.chat_id) : undefined,
      });
      if (result.ok && result.task_id) {
        await store.update_card(card_id, { task_id: result.task_id });
        await store.add_comment(card_id, "rule-executor", `태스크 생성: ${result.task_id}`);
      }
      log.info("rule_action_executed", { rule_id: rule.rule_id, action: "create_task", card_id, ok: result.ok, task_id: result.task_id });
      break;
    }
  }
}

export interface KanbanRuleExecutor {
  /** 특정 board의 이벤트를 구독하여 rule 자동 실행 시작. */
  watch(board_id: string): void;
  dispose(): void;
}

/** 보드별 kanban event listener를 등록하여 rule을 자동 실행. */
export function register_kanban_rule_executor(store: KanbanStoreLike, bridge?: RuleExecutionBridge): KanbanRuleExecutor {
  const board_listeners = new Map<string, (event: KanbanEvent) => void>();

  function watch(board_id: string): void {
    if (board_listeners.has(board_id)) return;
    const listener = (event: KanbanEvent) => {
      void evaluate_rules(store, event).catch((err) => {
        log.warn("rule_evaluate_error", { board_id, error: error_message(err) });
      });
    };
    board_listeners.set(board_id, listener);
    store.subscribe(board_id, listener);
  }

  async function evaluate_rules(kanban: KanbanStoreLike, event: KanbanEvent): Promise<void> {
    const { data: activity, board_id } = event;
    const trigger = action_to_trigger(activity.action);
    if (!trigger) return;

    const rules = await kanban.get_rules_by_trigger(board_id, trigger);

    // label 조건 평가를 위해 카드의 현재 labels를 detail에 병합
    const needs_label_check = rules.some((r) => r.enabled && r.condition.label);
    const detail = needs_label_check
      ? { ...activity.detail, labels: (await kanban.get_card(activity.card_id))?.labels ?? activity.detail.labels }
      : activity.detail;

    for (const rule of rules.filter((r) => r.enabled)) {
      if (!matches_trigger(rule, activity.action)) continue;
      if (!matches_condition(rule, detail)) continue;

      try {
        await execute_action(kanban, rule, activity.card_id, board_id, bridge);
      } catch (err) {
        log.warn("rule_action_error", { rule_id: rule.rule_id, card_id: activity.card_id, error: error_message(err) });
      }
    }
  }

  return {
    watch,
    dispose: () => {
      for (const [board_id, listener] of board_listeners) {
        store.unsubscribe(board_id, listener);
      }
      board_listeners.clear();
    },
  };
}

/** 기존 보드 중 활성 rule이 있는 보드에 대해 listener를 등록. */
export async function setup_kanban_rule_listeners(store: KanbanStoreLike, bridge?: RuleExecutionBridge): Promise<KanbanRuleExecutor> {
  const executor = register_kanban_rule_executor(store, bridge);
  const boards = await store.list_boards();
  for (const board of boards) {
    const rules = await store.list_rules(board.board_id);
    if (rules.some((r) => r.enabled)) {
      executor.watch(board.board_id);
    }
  }
  return executor;
}

function action_to_trigger(action: ActivityAction): KanbanRule["trigger"] | null {
  if (action === "moved") return "card_moved";
  if (action === "updated") return "subtasks_done";
  return null;
}
