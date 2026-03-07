/** continue_task_loop: 재개된 Task loop를 이어서 실행. */

import type { TaskNode } from "../../agent/loop.js";
import type { ProviderCapabilities } from "../../providers/executor.js";
import type { RuntimePolicyResolver } from "../../channels/runtime-policy.js";
import { StreamBuffer } from "../../channels/stream-buffer.js";
import {
  sanitize_provider_output,
  normalize_agent_reply,
} from "../../channels/output-sanitizer.js";
import { now_ms, short_id } from "../../utils/common.js";
import { resolve_executor_provider } from "../../providers/executor.js";
import {
  create_tool_call_handler, type ToolCallState,
} from "../tool-call-handler.js";
import {
  create_stream_handler, flush_remaining, emit_execution_info,
} from "../agent-hooks-builder.js";
import { error_result, suppress_result, reply_result, build_tool_context, build_context_message, inbound_scope_id } from "./helpers.js";
import { try_native_task_execute } from "./run-task-loop.js";
import type { RunnerDeps } from "./runner-deps.js";
import type { OrchestrationRequest, OrchestrationResult } from "../types.js";

/** continue_task_loop 전용 추가 의존성. */
export type ContinueTaskDeps = RunnerDeps & {
  policy_resolver: RuntimePolicyResolver;
  caps: () => ProviderCapabilities;
  build_system_prompt: (skill_names: string[], provider: string, chat_id: string, tool_categories?: ReadonlySet<string>, alias?: string) => Promise<string>;
  collect_skill_provider_preferences: (skill_names: string[]) => string[];
};

export async function continue_task_loop(
  deps: ContinueTaskDeps,
  req: OrchestrationRequest,
  task: import("../../contracts.js").TaskState,
  task_with_media: string,
  media: string[],
): Promise<OrchestrationResult> {
  const stream = new StreamBuffer();
  const always_skills = deps.runtime.get_always_skills();
  const skill_names = resolve_context_skills(deps, task_with_media, always_skills);
  const runtime_policy = deps.policy_resolver.resolve(task_with_media, media);
  const all_tool_definitions = deps.runtime.get_tool_definitions();
  const tool_ctx = build_tool_context(req, task.taskId);
  const executor = resolve_executor_provider(deps.config.executor_provider, deps.caps());
  const system_base = await deps.build_system_prompt(skill_names, req.provider, req.message.chat_id, undefined, req.alias);
  emit_execution_info(stream, req.on_stream, "task (재개)", executor, deps.logger);
  let total_tool_count = 0;

  if (req.run_id) {
    deps.process_tracker?.set_mode(req.run_id, "task");
    deps.process_tracker?.set_executor(req.run_id, executor);
    deps.process_tracker?.link_task(req.run_id, task.taskId);
  }

  const user_input = String(task.memory.__user_input || task_with_media);
  const history_lines = req.session_history.slice(-8).map((r) => `[${r.role}] ${r.content}`);
  const context_block = build_context_message(user_input, history_lines);

  const prior_session = deps.agent_backends?.get_session_store()?.find_by_task(`task:${task.taskId}`) ?? undefined;

  const nodes: TaskNode[] = [
    {
      id: "execute",
      run: async ({ task_state, memory }) => {
        const base_objective = task_state.objective || String(memory.objective || task_with_media);
        const objective = memory.__user_input
          ? `${base_objective}\n\n[사용자 응답] ${String(memory.__user_input)}`
          : base_objective;

        const skill_provider_prefs = deps.collect_skill_provider_preferences(skill_names);
        const native_result = await try_native_task_execute(
          deps,
          { req, executor, task_with_media, media, context_block, skill_names, system_base, runtime_policy, tool_definitions: all_tool_definitions, tool_ctx, skill_provider_prefs, request_scope: inbound_scope_id(req.message) },
          stream, tool_ctx, task.taskId, objective, context_block,
          prior_session,
        );
        if (native_result) {
          flush_remaining(stream, req.on_stream);
          const final = sanitize_provider_output(String(native_result.content || "")).trim();
          total_tool_count += native_result.tool_calls_count;
          const clear_patch = { ...memory, last_output: final, __user_input: undefined };
          if (native_result.finish_reason === "cancelled") {
            return { status: "completed" as const, memory_patch: { ...clear_patch, suppress_final_reply: true }, current_step: "execute", exit_reason: "cancelled" };
          }
          if (native_result.finish_reason === "approval_required") {
            return { status: "waiting_approval" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_approval" };
          }
          if (final.includes("__request_user_choice__")) {
            return { status: "waiting_user_input" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_user_input" };
          }
          return { status: "completed" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "workflow_completed" };
        }

        // legacy headless 경로
        const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };
        const resumed_loop_id = `resumed-${now_ms()}-${short_id(8)}`;
        if (req.run_id) deps.process_tracker?.link_loop(req.run_id, resumed_loop_id);
        const response = await deps.runtime.run_agent_loop({
          loop_id: resumed_loop_id,
          agent_id: req.alias,
          objective,
          context_builder: deps.runtime.get_context_builder(),
          providers: deps.providers,
          tools: all_tool_definitions,
          provider_id: executor,
          runtime_policy,
          current_message: `${deps.build_overlay("agent")}\n\n${context_block}`,
          history_days: [],
          skill_names,
          media,
          channel: req.provider,
          chat_id: req.message.chat_id,
          max_turns: deps.config.agent_loop_max_turns,
          model: undefined,
          max_tokens: 1800,
          temperature: 0.3,
          abort_signal: req.signal,
          on_stream: create_stream_handler(deps.streaming_cfg, stream, req.on_stream),
          check_should_continue: async () => false,
          on_tool_calls: create_tool_call_handler(deps.tool_deps, tool_ctx, state, {
            buffer: stream, on_stream: req.on_stream, on_tool_block: req.on_tool_block,
            on_tool_event: (e) => deps.session_cd.observe(e),
            log_ctx: req.run_id ? { run_id: req.run_id, agent_id: String(executor), provider: req.provider, chat_id: req.message.chat_id } : undefined,
          }),
          compaction_flush: deps.build_compaction_flush(),
        });

        flush_remaining(stream, req.on_stream);
        const final = sanitize_provider_output(String(response.final_content || "")).trim();
        total_tool_count += state.tool_count;

        const clear_patch = { ...memory, last_output: final, __user_input: undefined };

        if (state.done_sent) {
          return { status: "completed" as const, memory_patch: { ...clear_patch, suppress_final_reply: true }, current_step: "execute", exit_reason: "message_done_sent" };
        }
        if (final.includes("approval_required")) {
          return { status: "waiting_approval" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_approval" };
        }
        if (final.includes("__request_user_choice__")) {
          return { status: "waiting_user_input" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "waiting_user_input" };
        }
        return { status: "completed" as const, memory_patch: clear_patch, current_step: "execute", exit_reason: "workflow_completed" };
      },
    },
  ];

  const result = await deps.runtime.run_task_loop({
    task_id: task.taskId,
    title: task.title,
    objective: task.objective || String(task.memory.objective || task_with_media),
    channel: task.channel || req.provider,
    chat_id: task.chatId || req.message.chat_id,
    nodes,
    max_turns: deps.config.task_loop_max_turns,
    abort_signal: req.signal,
  });

  const output_raw = String(result.state.memory?.last_output || "").trim();
  if (result.state.memory?.suppress_final_reply === true) {
    return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
  }
  if (result.state.status === "waiting_approval") {
    deps.log_event({
      run_id: req.run_id || `resume-${now_ms()}`, task_id: task.taskId, agent_id: req.alias,
      provider: req.provider, channel: req.provider, chat_id: req.message.chat_id, source: "inbound",
      phase: "approval", summary: "waiting_approval (resume)", payload: { mode: "task", tool_calls_count: total_tool_count },
    });
    return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
  }
  if (result.state.status === "waiting_user_input" || result.state.status === "max_turns_reached") {
    return { ...suppress_result("task", stream, total_tool_count), run_id: req.run_id };
  }
  if (result.state.status === "failed" || result.state.status === "cancelled") {
    const reason = result.state.exitReason || result.state.status;
    deps.logger.warn("resume_task_terminal", { task_id: task.taskId, status: result.state.status, exit_reason: reason, turns: result.state.currentTurn });
    return { ...error_result("task", stream, `task_${result.state.status}:${reason}`, total_tool_count), run_id: req.run_id };
  }

  const output = sanitize_provider_output(output_raw).trim();
  if (!output) return { ...error_result("task", stream, `resume_task_no_output:${result.state.status}`, total_tool_count), run_id: req.run_id };
  return { ...reply_result("task", stream, normalize_agent_reply(output, req.alias, req.message.sender_id), total_tool_count), run_id: req.run_id };
}

/** 스킬 추천: always_skills + 태스크 기반 추천. */
function resolve_context_skills(deps: RunnerDeps, task: string, base: string[]): string[] {
  const out = new Set<string>(base.filter(Boolean));
  for (const s of deps.runtime.recommend_skills(task, 8)) {
    const name = String(s || "").trim();
    if (name) out.add(name);
  }
  return [...out];
}
