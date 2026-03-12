/** run_agent_loop: executor 루프 실행. native backend 우선, legacy headless 폴백. */

import type { ToolSchema } from "../../agent/tools/types.js";
import { StreamBuffer } from "../../channels/stream-buffer.js";
import {
  sanitize_provider_output,
  normalize_agent_reply,
  extract_provider_error,
} from "../../channels/output-sanitizer.js";
import { error_message, now_ms, short_id } from "../../utils/common.js";
import { detect_escalation } from "../classifier.js";
import { AGENT_TOOL_NUDGE } from "../prompts.js";
import {
  create_tool_call_handler, type ToolCallState,
} from "../tool-call-handler.js";
import {
  create_stream_handler, flush_remaining, emit_execution_info,
} from "../agent-hooks-builder.js";
import { error_result, reply_result, suppress_result, append_no_tool_notice } from "./helpers.js";
import type { RunExecutionArgs, RunnerDeps } from "./runner-deps.js";
import { streaming_cfg_for } from "./runner-deps.js";
import type { OrchestrationResult } from "../types.js";

export async function run_agent_loop(
  deps: RunnerDeps,
  args: RunExecutionArgs & { media: string[] },
): Promise<OrchestrationResult> {
  const stream = new StreamBuffer();
  emit_execution_info(stream, args.req.on_stream, "agent", args.executor, deps.logger);

  // native backend 우선: 스마트 라우팅 → 레거시 폴백
  const tools_used: string[] = [];
  if (deps.agent_backends) {
    const backend = deps.agent_backends.resolve_for_mode("agent", args.skill_provider_prefs)
      ?? deps.agent_backends.resolve_backend(args.executor);
    if (backend?.native_tool_loop) {
      try {
        const system = args.system_base;
        const caps = backend.capabilities;
        const result = await deps.agent_backends.run(backend.id, {
          task: args.context_block,
          task_id: `agent:${args.req.provider}:${args.req.message.chat_id}:${args.req.alias}`,
          system_prompt: `${system}\n\n${deps.build_overlay("agent")}`,
          tools: args.tool_definitions as ToolSchema[],
          tool_executors: deps.runtime.get_tool_executors(),
          runtime_policy: args.runtime_policy,
          max_tokens: 1800,
          temperature: 0.3,
          max_turns: deps.config.agent_loop_max_turns,
          effort: "high",
          ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 16000 } : {}),
          hooks: deps.hooks_for(stream, args, backend.id, args.tool_ctx.task_id, tools_used),
          abort_signal: args.req.signal,
          cwd: deps.workspace,
          mcp_server_configs: deps.get_mcp_configs?.() ?? undefined,
          tool_context: args.tool_ctx,
        });
        flush_remaining(stream, args.req.on_stream);
        const orch = deps.convert_agent_result(result, "agent", stream, args.req);
        orch.tools_used = [...new Set(tools_used)];
        return orch;
      } catch (e) {
        const msg = error_message(e);
        deps.logger.warn("native_tool_loop run_agent_loop error, falling back to legacy", { error: msg });
        // fallback: legacy headless 경로
      }
    }
  }

  // legacy headless 경로
  const state: ToolCallState = { suppress: false, tool_count: 0 };

  const loop_id = `loop-${now_ms()}-${short_id(8)}`;
  if (args.req.run_id) deps.process_tracker?.link_loop(args.req.run_id, loop_id);

  const response = await deps.runtime.run_agent_loop({
    loop_id,
    agent_id: args.req.alias,
    objective: args.task_with_media || "handle inbound request",
    context_builder: deps.runtime.get_context_builder(),
    providers: deps.providers,
    tools: args.tool_definitions,
    provider_id: args.executor,
    runtime_policy: args.runtime_policy,
    current_message: `${deps.build_overlay("agent")}\n\n${args.context_block}`,
    history_days: [],
    skill_names: args.skill_names,
    media: args.media,
    channel: args.req.provider,
    chat_id: args.req.message.chat_id,
    max_turns: deps.config.agent_loop_max_turns,
    model: args.preferred_model,
    max_tokens: 1800,
    temperature: 0.3,
    abort_signal: args.req.signal,
    on_stream: create_stream_handler(streaming_cfg_for(deps.streaming_cfg, args.req.provider), stream, args.req.on_stream),
    on_stream_event: args.req.on_stream_event,
    check_should_continue: async ({ state: s }) => {
      if (s.currentTurn >= (deps.config.agent_loop_max_turns ?? 10)) return false;
      return AGENT_TOOL_NUDGE;
    },
    on_tool_calls: create_tool_call_handler(deps.tool_deps, args.tool_ctx, state, {
      buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
      on_tool_event: (e) => {
        deps.session_cd.observe(e);
        if (e.type === "tool_use" && e.tool_name) tools_used.push(e.tool_name);
      },
      log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
    }),
    compaction_flush: deps.build_compaction_flush(args.req),
  });

  flush_remaining(stream, args.req.on_stream);

  if (state.suppress) return suppress_result("agent", stream, state.tool_count);

  const content = sanitize_provider_output(String(response.final_content || ""));
  if (!content) return error_result("agent", stream, "empty_provider_response", state.tool_count);

  // agent → task 에스컬레이션 감지 (legacy 경로)
  const escalation = detect_escalation(content, "agent");
  if (escalation) return error_result("agent", stream, escalation, state.tool_count);

  const err = extract_provider_error(content);
  if (err) return error_result("agent", stream, err, state.tool_count);

  const reply = normalize_agent_reply(content, args.req.alias, args.req.message.sender_id);
  if (!reply) return error_result("agent", stream, "empty_provider_response", state.tool_count);
  const final_reply = state.tool_count === 0 ? append_no_tool_notice(reply) : reply;
  const legacy_result = reply_result("agent", stream, final_reply, state.tool_count);
  legacy_result.tools_used = [...new Set(tools_used)];
  return legacy_result;
}
