/** run_task_loop + _try_native_task_execute: Task 모드 실행. */

import type { AgentRunResult, AgentSession } from "../../agent/agent.types.js";
import type { TaskNode } from "../../agent/loop.js";
import type { ToolSchema } from "../../agent/tools/types.js";
import type { ToolExecutionContext } from "../../agent/tools/types.js";
import { StreamBuffer } from "../../channels/stream-buffer.js";
import {
  sanitize_provider_output,
  normalize_agent_reply,
  extract_provider_error,
} from "../../channels/output-sanitizer.js";
import { error_message, now_ms, short_id } from "../../utils/common.js";
import {
  create_tool_call_handler, type ToolCallState,
} from "../tool-call-handler.js";
import {
  create_stream_handler, flush_remaining, emit_execution_info,
} from "../agent-hooks-builder.js";
import { error_result, reply_result, suppress_result, raw_message_id } from "./helpers.js";
import type { RunExecutionArgs, RunnerDeps } from "./runner-deps.js";
import type { OrchestrationResult } from "../types.js";

/** task execute 노드에서 네이티브 백엔드로 실행 시도. 성공 시 AgentRunResult, 불가 시 null. */
export async function try_native_task_execute(
  deps: RunnerDeps,
  args: RunExecutionArgs & { media: string[] },
  stream: StreamBuffer,
  task_tool_ctx: ToolExecutionContext,
  task_id: string,
  _objective: string,
  seed_prompt: string,
  resume_session?: AgentSession,
  tools_accumulator?: string[],
): Promise<AgentRunResult | null> {
  if (!deps.agent_backends) return null;
  const backend = deps.agent_backends.resolve_for_mode("task", args.skill_provider_prefs)
    ?? deps.agent_backends.resolve_backend(args.executor);
  if (!backend?.native_tool_loop) return null;

  try {
    const system = args.system_base;
    const caps = backend.capabilities;
    return await deps.agent_backends.run(backend.id, {
      task: seed_prompt,
      task_id: `task:${task_id}`,
      system_prompt: `${system}\n\n${deps.build_overlay("agent")}`,
      tools: args.tool_definitions as ToolSchema[],
      tool_executors: deps.runtime.get_tool_executors(),
      runtime_policy: args.runtime_policy,
      max_tokens: 1800,
      temperature: 0.3,
      max_turns: deps.config.agent_loop_max_turns,
      effort: "high",
      ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
      hooks: deps.hooks_for(stream, args, backend.id, task_tool_ctx.task_id, tools_accumulator),
      abort_signal: args.req.signal,
      cwd: deps.workspace,
      mcp_server_configs: deps.get_mcp_configs?.() ?? undefined,
      tool_context: task_tool_ctx,
      ...(resume_session ? { resume_session } : {}),
      ...(args.req.register_send_input ? { register_send_input: args.req.register_send_input } : {}),
      wait_for_input_ms: 30_000,
    });
  } catch (e) {
    const msg = error_message(e);
    deps.logger.warn("native_tool_loop task_execute error, falling back to legacy", { error: msg });
    return null;
  }
}

export async function run_task_loop(
  deps: RunnerDeps,
  args: RunExecutionArgs & { media: string[] },
): Promise<OrchestrationResult> {
  const stream = new StreamBuffer();
  emit_execution_info(stream, args.req.on_stream, "task", args.executor, deps.logger);
  const task_id = `task:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}:${args.request_scope}`.toLowerCase();
  if (args.req.run_id) deps.process_tracker?.link_task(args.req.run_id, task_id);
  deps.log_event({
    run_id: args.req.run_id || `task-${Date.now()}`,
    task_id, agent_id: args.req.alias,
    provider: args.req.provider, channel: args.req.provider, chat_id: args.req.message.chat_id,
    source: "inbound",
    phase: "progress", summary: `task_started: ${task_id}`,
    payload: { mode: "task", executor: args.executor },
  });
  const FILE_WAIT_MARKER = "__file_request_waiting__";
  let total_tool_count = 0;
  const tools_used: string[] = [];

  const nodes: TaskNode[] = [
    {
      id: "plan",
      run: async ({ memory }) => ({
        memory_patch: { ...memory, seed_prompt: args.context_block, mode: "task_loop" },
        next_step_index: 1,
        current_step: "plan",
      }),
    },
    {
      id: "execute",
      run: async ({ task_state, memory }) => {
        const task_tool_ctx: ToolExecutionContext = { ...args.tool_ctx, task_id };
        const objective = task_state.objective || String(memory.objective || args.task_with_media);
        const seed_prompt = String(memory.seed_prompt || args.context_block);

        // native backend 우선: 전체 tool loop를 백엔드에 위임
        const native_result = await try_native_task_execute(deps, args, stream, task_tool_ctx, task_id, objective, seed_prompt, undefined, tools_used);
        if (native_result) {
          flush_remaining(stream, args.req.on_stream);
          const final = sanitize_provider_output(String(native_result.content || "")).trim();
          total_tool_count += native_result.tool_calls_count;
          if (native_result.finish_reason === "cancelled") {
            return { status: "completed", memory_patch: { ...memory, suppress_final_reply: true, last_output: final }, current_step: "execute", exit_reason: "cancelled" };
          }
          if (native_result.finish_reason === "approval_required") {
            return { status: "waiting_approval", memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_approval" };
          }
          if (final.includes("__request_user_choice__")) {
            return { status: "waiting_user_input" as const, memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_user_input" };
          }
          return { memory_patch: { ...memory, last_output: final }, next_step_index: 2, current_step: "execute" };
        }

        // legacy headless 경로
        const state: ToolCallState = { suppress: false, file_requested: false, done_sent: false, tool_count: 0 };

        const nested_loop_id = `nested-${now_ms()}-${short_id(8)}`;
        if (args.req.run_id) deps.process_tracker?.link_loop(args.req.run_id, nested_loop_id);

        const response = await deps.runtime.run_agent_loop({
          loop_id: nested_loop_id,
          agent_id: args.req.alias,
          objective,
          context_builder: deps.runtime.get_context_builder(),
          providers: deps.providers,
          tools: args.tool_definitions,
          provider_id: args.executor,
          runtime_policy: args.runtime_policy,
          current_message: `${deps.build_overlay("agent")}\n\n${seed_prompt}`,
          history_days: [],
          skill_names: args.skill_names,
          media: args.media,
          channel: args.req.provider,
          chat_id: args.req.message.chat_id,
          max_turns: deps.config.agent_loop_max_turns,
          model: undefined,
          max_tokens: 1800,
          temperature: 0.3,
          abort_signal: args.req.signal,
          on_stream: create_stream_handler(deps.streaming_cfg, stream, args.req.on_stream),
          check_should_continue: async () => false,
          on_tool_calls: create_tool_call_handler(deps.tool_deps, task_tool_ctx, state, {
            buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
            on_tool_event: (e) => {
              deps.session_cd.observe(e);
              if (e.type === "tool_use" && e.tool_name) tools_used.push(e.tool_name);
            },
            log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
          }),
          compaction_flush: deps.build_compaction_flush(),
        });

        flush_remaining(stream, args.req.on_stream);
        const final = sanitize_provider_output(String(response.final_content || "")).trim();

        if (state.file_requested) {
          return { status: "completed", memory_patch: { ...memory, file_request_waiting: true, last_output: FILE_WAIT_MARKER }, current_step: "execute", exit_reason: "file_request_waiting" };
        }
        if (state.done_sent) {
          return { status: "completed", memory_patch: { ...memory, suppress_final_reply: true, last_output: final }, current_step: "execute", exit_reason: "message_done_sent" };
        }
        if (final.includes("approval_required")) {
          return { status: "waiting_approval", memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_approval" };
        }
        if (final.includes("__request_user_choice__")) {
          return { status: "waiting_user_input" as const, memory_patch: { ...memory, last_output: final }, current_step: "execute", exit_reason: "waiting_user_input" };
        }
        total_tool_count += state.tool_count;
        return { memory_patch: { ...memory, last_output: final }, next_step_index: 2, current_step: "execute" };
      },
    },
    {
      id: "finalize",
      run: async ({ memory }) => ({ status: "completed", memory_patch: memory, current_step: "finalize", exit_reason: "workflow_completed" }),
    },
  ];

  const result = await deps.runtime.run_task_loop({
    task_id,
    title: `ChannelTask:${args.req.alias}`,
    objective: args.task_with_media,
    channel: args.req.provider,
    chat_id: args.req.message.chat_id,
    nodes,
    max_turns: args.req.max_turns ?? deps.config.task_loop_max_turns,
    initial_memory: {
      ...args.req.initial_memory,
      alias: args.req.alias,
      channel: args.req.provider,
      chat_id: args.req.message.chat_id,
      __trigger_message_id: raw_message_id(args.req.message),
    },
    abort_signal: args.req.signal,
  });

  const output_raw = String(result.state.memory?.last_output || "").trim();
  if (result.state.memory?.file_request_waiting === true || output_raw === FILE_WAIT_MARKER) {
    return suppress_result("task", stream, total_tool_count);
  }
  if (result.state.memory?.suppress_final_reply === true) {
    return suppress_result("task", stream, total_tool_count);
  }
  if (result.state.status === "waiting_approval") {
    deps.log_event({
      run_id: args.req.run_id || `task-${now_ms()}`, task_id, agent_id: args.req.alias,
      provider: args.req.provider, channel: args.req.provider, chat_id: args.req.message.chat_id, source: "inbound",
      phase: "approval", summary: "waiting_approval", payload: { mode: "task", tool_calls_count: total_tool_count },
    });
    return { ...suppress_result("task", stream, total_tool_count), run_id: args.req.run_id };
  }
  if (result.state.status === "waiting_user_input" || result.state.status === "max_turns_reached") {
    return { ...suppress_result("task", stream, total_tool_count), run_id: args.req.run_id };
  }
  if (result.state.status === "failed" || result.state.status === "cancelled") {
    const reason = result.state.exitReason || result.state.status;
    deps.logger.warn("task_loop_terminal", { task_id, status: result.state.status, exit_reason: reason, turns: result.state.currentTurn });
    return error_result("task", stream, `task_${result.state.status}:${reason}`, total_tool_count);
  }

  const output = sanitize_provider_output(output_raw).trim();
  if (!output) return error_result("task", stream, `task_loop_no_output:${result.state.status}`, total_tool_count);

  const err = extract_provider_error(output);
  if (err) return error_result("task", stream, err, total_tool_count);

  const task_result = reply_result("task", stream, normalize_agent_reply(output, args.req.alias, args.req.message.sender_id), total_tool_count);
  task_result.tools_used = [...new Set(tools_used)];
  return task_result;
}
