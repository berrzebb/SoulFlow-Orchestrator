/** run_once: executor에게 1회 질의. 오케스트레이터 LLM은 분류만 수행하고 실제 응답은 executor가 생성. */

import type { ChatMessage } from "../../providers/types.js";
import type { ToolSchema } from "../../agent/tools/types.js";
import { StreamBuffer } from "../../channels/stream-buffer.js";
import {
  sanitize_provider_output,
  normalize_agent_reply,
  extract_provider_error,
} from "../../channels/output-sanitizer.js";
import { error_message } from "../../utils/common.js";
import { detect_escalation } from "../classifier.js";
import {
  create_tool_call_handler, type ToolCallState,
} from "../tool-call-handler.js";
import {
  create_stream_handler, flush_remaining, emit_execution_info,
} from "../agent-hooks-builder.js";
import { error_result, reply_result, suppress_result } from "./helpers.js";
import type { RunExecutionArgs, RunnerDeps } from "./runner-deps.js";
import { streaming_cfg_for } from "./runner-deps.js";
import type { OrchestrationResult } from "../types.js";

export async function run_once(deps: RunnerDeps, args: RunExecutionArgs): Promise<OrchestrationResult> {
  const stream = new StreamBuffer();
  emit_execution_info(stream, args.req.on_stream, "once", args.executor, deps.logger);
  const { system_base } = args;
  const messages: ChatMessage[] = [
    { role: "system", content: `${system_base}\n\n${deps.build_overlay("once")}` },
    { role: "user", content: args.context_block },
  ];

  // native_tool_loop 백엔드: 스마트 라우팅 우선, 레거시 폴백.
  const tools_used: string[] = [];
  if (deps.agent_backends) {
    const backend = deps.agent_backends.resolve_for_mode("once", args.skill_provider_prefs)
      ?? deps.agent_backends.resolve_backend(args.executor);
    if (backend?.native_tool_loop) {
      try {
        const caps = backend.capabilities;
        // once 모드는 매 요청 fresh thread — resume하면 세션 무한 누적으로 토큰 폭증
        const once_task_id = `once:${args.req.provider}:${args.req.message.chat_id}:${Date.now()}`;
        const result = await deps.agent_backends.run(backend.id, {
          task: args.context_block,
          task_id: once_task_id,
          system_prompt: String(messages[0].content || ""),
          tools: args.tool_definitions as ToolSchema[],
          tool_executors: deps.runtime.get_tool_executors(),
          runtime_policy: args.runtime_policy,
          max_tokens: 1600,
          temperature: 0.3,
          max_turns: deps.config.agent_loop_max_turns,
          effort: "medium",
          ...(caps.thinking ? { enable_thinking: true, max_thinking_tokens: 10000 } : {}),
          hooks: deps.hooks_for(stream, args, backend.id, args.tool_ctx.task_id, tools_used),
          abort_signal: args.req.signal,
          cwd: deps.workspace,
          mcp_server_configs: deps.get_mcp_configs?.() ?? undefined,
          tool_context: args.tool_ctx,
        });
        flush_remaining(stream, args.req.on_stream);
        const orch = deps.convert_agent_result(result, "once", stream, args.req);
        orch.tools_used = [...new Set(tools_used)];
        return orch;
      } catch (e) {
        const msg = error_message(e);
        deps.logger.warn("native_tool_loop run_once error", { error: msg });
        return error_result("once", stream, msg);
      }
    }
  }

  try {
    const response = await deps.providers.run_headless({
      provider_id: args.executor,
      model: args.preferred_model,
      messages,
      tools: args.tool_definitions,
      max_tokens: 1600,
      temperature: 0.3,
      runtime_policy: args.runtime_policy,
      abort_signal: args.req.signal,
      on_stream: create_stream_handler(streaming_cfg_for(deps.streaming_cfg, args.req.provider), stream, args.req.on_stream),
    });

    const err = extract_provider_error(String(response.content || ""));
    if (err) return error_result("once", stream, err);

    if (response.has_tool_calls) {
      deps.logger.debug("once: tool calls", { count: response.tool_calls.length });
      const tool_state: ToolCallState = { suppress: false, tool_count: 0 };
      const handler = create_tool_call_handler(deps.tool_deps, args.tool_ctx, tool_state, {
        buffer: stream, on_stream: args.req.on_stream, on_tool_block: args.req.on_tool_block,
        on_tool_event: (e) => {
          deps.session_cd.observe(e);
          if (e.type === "tool_use" && e.tool_name) tools_used.push(e.tool_name);
        },
        log_ctx: args.req.run_id ? { run_id: args.req.run_id, agent_id: String(args.executor), provider: args.req.provider, chat_id: args.req.message.chat_id } : undefined,
      });
      const tool_output = await handler({ tool_calls: response.tool_calls });

      if (tool_state.suppress) return suppress_result("once", stream, tool_state.tool_count);

      const followup = await deps.providers.run_headless({
        provider_id: args.executor,
        model: args.preferred_model,
        messages: [
          ...messages,
          { role: "assistant", content: `[TOOL_RESULTS]\n${tool_output}` },
          { role: "user", content: deps.build_persona_followup(deps.runtime.get_context_builder().skills_loader.get_role_skill("concierge")?.heart || "") },
        ],
        max_tokens: 800,
        temperature: 0.2,
        abort_signal: args.req.signal,
        on_stream: create_stream_handler(streaming_cfg_for(deps.streaming_cfg, args.req.provider), stream, args.req.on_stream),
      });
      flush_remaining(stream, args.req.on_stream);
      const followup_text = sanitize_provider_output(String(followup.content || "")).trim();
      const final_text = followup_text || tool_output;
      const once_result = reply_result("once", stream, normalize_agent_reply(final_text, args.req.alias, args.req.message.sender_id), tool_state.tool_count);
      once_result.tools_used = [...new Set(tools_used)];
      return once_result;
    }

    flush_remaining(stream, args.req.on_stream);
    const content = sanitize_provider_output(String(response.content || ""));
    const final = content.trim();
    if (!final) return error_result("once", stream, "executor_once_empty");

    const escalation = detect_escalation(final);
    if (escalation) return error_result("once", stream, escalation);

    return reply_result("once", stream, normalize_agent_reply(final, args.req.alias, args.req.message.sender_id), 0);
  } catch (e) {
    const msg = error_message(e);
    deps.logger.warn("run_once error", { error: msg });
    return error_result("once", stream, msg);
  }
}
