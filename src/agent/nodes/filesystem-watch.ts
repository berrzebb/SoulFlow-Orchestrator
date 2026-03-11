/** 파일시스템 감시 트리거 노드 — 지정 폴더의 파일 변경 감지 시 워크플로우 시작. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { TriggerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message, now_iso } from "../../utils/common.js";

export const filesystem_watch_handler: NodeHandler = {
  node_type: "filesystem_watch",
  icon: "\u{1F4C1}",
  color: "#00897b",
  shape: "rect",
  output_schema: [
    { name: "files",        type: "array",  description: "Changed file list [{path, event, size_bytes}]" },
    { name: "batch_id",     type: "string", description: "Batch ID (UUID)" },
    { name: "triggered_at", type: "string", description: "Trigger timestamp (ISO 8601)" },
    { name: "watch_path",   type: "string", description: "Watched directory path" },
  ],
  input_schema: [],
  create_default: () => ({
    trigger_type: "filesystem_watch",
    watch_path: "",
    watch_events: ["add"],
    watch_pattern: "",
    watch_batch_ms: 500,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { files: [], batch_id: "", triggered_at: now_iso(), watch_path: "" } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const wait = runner.services?.wait_filesystem_event;
    if (!wait) return this.execute(node, _ctx);

    const n = node as unknown as TriggerNodeDefinition;
    const watch_path = n.watch_path?.trim();
    if (!watch_path) {
      return { output: { files: [], batch_id: "", triggered_at: now_iso(), watch_path: "", error: "watch_path is required" } };
    }

    // resume 시 이미 주입된 이벤트가 있으면 즉시 반환
    const injected = runner.state?.memory?.__pending_filesystem_watch_event;
    if (injected && typeof injected === "object") {
      delete runner.state!.memory.__pending_filesystem_watch;
      delete runner.state!.memory.__pending_filesystem_watch_event;
      return { output: injected as Record<string, unknown> };
    }

    try {
      const event = await wait(watch_path, {
        events: n.watch_events?.length ? n.watch_events : ["add"],
        pattern: n.watch_pattern?.trim() || undefined,
        batch_ms: n.watch_batch_ms ?? 500,
      });
      if (!event) {
        return { output: { files: [], batch_id: "", triggered_at: now_iso(), watch_path, waiting: true } };
      }
      return { output: event };
    } catch (err) {
      runner.logger.warn("filesystem_watch_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { files: [], batch_id: "", triggered_at: now_iso(), watch_path, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as unknown as TriggerNodeDefinition;
    const warnings: string[] = [];
    if (!n.watch_path?.trim()) warnings.push("watch_path is required");
    if (!n.watch_events?.length) warnings.push("at least one watch_events filter recommended");
    return {
      preview: { watch_path: n.watch_path, events: n.watch_events, pattern: n.watch_pattern, batch_ms: n.watch_batch_ms },
      warnings,
    };
  },
};
