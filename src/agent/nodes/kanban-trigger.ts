/** 칸반 이벤트 트리거 노드 — 보드에 카드 생성/이동 등 이벤트 발생 시 워크플로우 시작. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { TriggerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const kanban_trigger_handler: NodeHandler = {
  node_type: "kanban_trigger",
  icon: "\u{1F4CB}",
  color: "#9b59b6",
  shape: "rect",
  output_schema: [
    { name: "card_id",    type: "string",  description: "Triggered card ID (e.g. SO-25)" },
    { name: "board_id",   type: "string",  description: "Board ID" },
    { name: "action",     type: "string",  description: "Activity action (created, moved, poll, etc.)" },
    { name: "actor",      type: "string",  description: "Who triggered the event" },
    { name: "detail",     type: "object",  description: "Activity detail payload (poll 모드: 카드 전체 데이터)" },
    { name: "created_at", type: "string",  description: "Event timestamp" },
    { name: "cards",      type: "array",   description: "Poll 모드 전용: 컬럼 내 전체 카드 목록" },
  ],
  input_schema: [],
  create_default: () => ({
    trigger_type: "kanban_event",
    kanban_board_id: "",
    kanban_actions: ["created"],
    kanban_column_id: "",
    kanban_mode: "event",
    kanban_poll_interval_s: 60,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { card_id: "", board_id: "", action: "created", actor: "", detail: {}, created_at: "" } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const wait = runner.services?.wait_kanban_event;
    if (!wait) return this.execute(node, _ctx);

    const n = node as unknown as TriggerNodeDefinition;
    const board_id = n.kanban_board_id?.trim();
    if (!board_id) {
      return { output: { card_id: "", board_id: "", action: "", actor: "", detail: {}, created_at: "", error: "kanban_board_id is required" } };
    }

    // P0-6: resume 시 이미 주입된 이벤트가 있으면 wait 없이 즉시 반환
    const injected = runner.state?.memory?.__pending_kanban_trigger_event;
    if (injected && typeof injected === "object") {
      delete runner.state!.memory.__pending_kanban_trigger;
      delete runner.state!.memory.__pending_kanban_trigger_event;
      return { output: injected as Record<string, unknown> };
    }

    try {
      const event = await wait(board_id, {
        actions: n.kanban_actions?.length ? n.kanban_actions : undefined,
        column_id: n.kanban_column_id?.trim() || undefined,
      });
      if (!event) {
        return { output: { card_id: "", board_id, action: "", actor: "", detail: {}, created_at: "", waiting: true } };
      }
      return { output: event };
    } catch (err) {
      runner.logger.warn("kanban_trigger_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { card_id: "", board_id, action: "", actor: "", detail: {}, created_at: "", error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as unknown as TriggerNodeDefinition;
    const mode = n.kanban_mode ?? "event";
    const warnings: string[] = [];
    if (!n.kanban_board_id?.trim()) warnings.push("kanban_board_id is required");
    if (mode === "event" && !n.kanban_actions?.length) warnings.push("at least one kanban_actions filter recommended");
    if (mode === "poll" && !n.kanban_column_id?.trim()) warnings.push("kanban_column_id is required for poll mode");
    return {
      preview: { mode, board_id: n.kanban_board_id, actions: n.kanban_actions, column_id: n.kanban_column_id, poll_interval_s: n.kanban_poll_interval_s },
      warnings,
    };
  },
};
