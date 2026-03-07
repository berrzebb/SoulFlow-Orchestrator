/** Phase 4.5: Execute Dispatcher — gateway 라우팅 → short-circuit → mode 분기 → finalize
 *
 * execute() 초반부의 preflight 이후 dispatcher 로직을 한 곳으로 수렴.
 * gateway 결정 → identity/builtin/inquiry short-circuit → phase/once/agent/task 분기 → finalize
 */

import type { RunExecutionArgs } from "./runner-deps.js";
import type { OrchestrationRequest, OrchestrationResult, ExecutionMode } from "../types.js";
import type { ReadyPreflight } from "../request-preflight.js";
import type { ProviderRegistry } from "../../providers/service.js";
import type { ExecutorProvider, ProviderCapabilities } from "../../providers/executor.js";
import { resolve_executor_provider } from "../../providers/executor.js";
import type { AgentRuntimeLike } from "../../agent/runtime.types.js";
import type { Logger } from "../../logger.js";
import type { ProcessTrackerLike } from "../process-tracker.js";
import type { ConfirmationGuard } from "../confirmation-guard.js";
import { format_guard_prompt } from "../confirmation-guard.js";
import type { AppendWorkflowEventInput } from "../../events/index.js";
import { resolve_gateway } from "../gateway.js";
import { error_message } from "../../utils/common.js";
import { select_tools_for_request } from "../tool-selector.js";
import { detect_escalation, is_once_escalation, is_agent_escalation } from "../classifier.js";
import { error_result } from "./helpers.js";

export type ExecuteDispatcherDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;
  config: {
    executor_provider: ExecutorProvider;
    provider_caps?: ProviderCapabilities;
  };
  process_tracker: ProcessTrackerLike | null;
  guard: ConfirmationGuard | null;
  tool_index: import("../tool-index.js").ToolIndex | null;
  log_event: (input: AppendWorkflowEventInput) => void;
  build_identity_reply: () => string;
  build_system_prompt: (names: string[], provider: string, chat_id: string, cats?: ReadonlySet<string>, alias?: string) => Promise<string>;
  generate_guard_summary: (task_text: string) => Promise<string>;
  run_once: (args: RunExecutionArgs) => Promise<OrchestrationResult>;
  run_agent_loop: (args: RunExecutionArgs & { media: string[]; history_lines: string[] }) => Promise<OrchestrationResult>;
  run_task_loop: (args: RunExecutionArgs & { media: string[] }) => Promise<OrchestrationResult>;
  run_phase_loop: (req: OrchestrationRequest, task_with_media: string, workflow_hint?: string, node_categories?: string[]) => Promise<OrchestrationResult>;
  caps: () => ProviderCapabilities;
};

/** execute() preflight 이후 dispatcher 로직. gateway 라우팅 → short-circuit/runner 진입 → finalize */
export async function execute_dispatch(
  deps: ExecuteDispatcherDeps,
  req: OrchestrationRequest,
  preflight: ReadyPreflight,
): Promise<OrchestrationResult> {
  const {
    task_with_media, media, skill_names, runtime_policy, all_tool_definitions,
    request_scope, evt_base, history_lines,
    context_block, tool_ctx, skill_tool_names, skill_provider_prefs,
    category_map, tool_categories,
  } = preflight;

  // active_tasks 조회
  const active_tasks_in_chat = deps.runtime.list_active_tasks().filter(
    (t) => String(t.memory?.chat_id || "") === String(req.message.chat_id),
  );

  // Gateway: 분류 + 라우팅 결정
  const decision = await resolve_gateway(
    task_with_media,
    {
      active_tasks: active_tasks_in_chat,
      recent_history: req.session_history.slice(-6),
      available_tool_categories: tool_categories,
      available_skills: skill_names.map(name => {
        const meta = deps.runtime.get_context_builder().skills_loader.get_skill_metadata(name);
        return meta
          ? { name, summary: meta.summary, triggers: meta.triggers }
          : { name, summary: "", triggers: [] };
      }),
    },
    active_tasks_in_chat,
    {
      providers: deps.providers,
      provider_caps: deps.caps(),
      executor_preference: deps.config.executor_provider,
      session_lookup: (task_id: string) => deps.runtime.find_session_by_task(task_id),
      logger: deps.logger,
    },
  );

  // Short-circuit: identity
  if (decision.action === "identity") {
    const identity_reply = deps.build_identity_reply();
    deps.log_event({ ...evt_base, phase: "done", summary: "identity shortcircuit", payload: { mode: "identity" } });
    return { reply: identity_reply, mode: "once", tool_calls_count: 0, streamed: false };
  }

  // Short-circuit: builtin
  if (decision.action === "builtin") {
    deps.log_event({ ...evt_base, phase: "done", summary: `builtin: ${decision.command}`, payload: { mode: "builtin", command: decision.command } });
    return { reply: null, mode: "once", tool_calls_count: 0, streamed: false, builtin_command: decision.command, builtin_args: decision.args };
  }

  // Short-circuit: inquiry
  if (decision.action === "inquiry") {
    deps.log_event({ ...evt_base, phase: "done", summary: "inquiry shortcircuit", payload: { mode: "inquiry", active_count: active_tasks_in_chat.length } });
    return { reply: decision.summary, mode: "once", tool_calls_count: 0, streamed: false };
  }

  const { mode, executor } = decision;

  // finalize: done/blocked 이벤트 기록 + process tracker 종료
  const finalize = (result: OrchestrationResult): OrchestrationResult => {
    const phase = result.error ? "blocked" : "done";
    deps.log_event({
      ...evt_base,
      phase,
      summary: result.error ? `failed: ${result.error.slice(0, 120)}` : `completed: ${result.mode}`,
      payload: { mode: result.mode, tool_calls_count: result.tool_calls_count, ...(result.usage ?? {}), ...(result.error ? { error: result.error } : {}) },
      detail: result.error || (result.reply ?? "").slice(0, 500) || null,
    });
    if (req.run_id) {
      deps.process_tracker?.set_tool_count(req.run_id, result.tool_calls_count);
      deps.process_tracker?.end(req.run_id, result.error ? "failed" : "completed", result.error || undefined);
    }
    return result;
  };

  // phase 모드 → Phase Loop Runner에 위임 (도구 선택 전에 분기)
  if (mode === "phase") {
    deps.log_event({ ...evt_base, phase: "progress", summary: "executing: phase", payload: { mode, executor } });
    const workflow_hint = decision.workflow_id;
    const node_cats = decision.node_categories;
    return finalize(await deps.run_phase_loop(req, task_with_media, workflow_hint, node_cats));
  }

  const classifier_cats = decision.action === "execute" ? decision.tool_categories : undefined;
  const { tools: tool_definitions, categories } = await select_tools_for_request(
    all_tool_definitions, task_with_media, mode, skill_tool_names, classifier_cats, category_map, classifier_cats, deps.tool_index,
  );
  const system_base = await deps.build_system_prompt(skill_names, req.provider, req.message.chat_id, new Set(categories), req.alias);
  deps.logger.info("dispatch", { mode, executor, skills: skill_names, tool_count: tool_definitions.length });

  // Confirmation Guard: 중요 작업 실행 전 사용자 확인
  if (deps.guard?.needs_confirmation(mode, categories, req.provider, req.message.chat_id)) {
    const summary = await deps.generate_guard_summary(task_with_media);
    deps.guard.store(req.provider, req.message.chat_id, task_with_media, summary, mode, categories);
    deps.logger.info("guard_confirmation_pending", { mode, categories, provider: req.provider, chat_id: req.message.chat_id });
    return { reply: format_guard_prompt(summary, mode, categories), mode: "once", tool_calls_count: 0, streamed: false };
  }

  if (req.run_id) {
    deps.process_tracker?.set_mode(req.run_id, mode);
    deps.process_tracker?.set_executor(req.run_id, executor);
  }
  deps.log_event({ ...evt_base, phase: "progress", summary: `executing: ${mode}`, payload: { mode, executor } });

  // once → executor 1회 호출. 에스컬레이션 시 executor 루프로 전환.
  try {
    let escalation_error: string | undefined;
    if (mode === "once") {
      const once_result = await deps.run_once({
        req, executor, task_with_media, context_block, skill_names, system_base,
        runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
      });
      if (!is_once_escalation(once_result.error)) {
        return finalize(once_result);
      }
      escalation_error = once_result.error ?? undefined;
    }

    // agent/task 또는 once 에스컬레이션 → executor 루프
    const loop_mode: "task" | "agent" = mode === "task"
      ? "task"
      : (escalation_error === "once_requires_task_loop" ? "task" : "agent");

    if (req.run_id && loop_mode !== mode) deps.process_tracker?.set_mode(req.run_id, loop_mode);

    const run_loop = async (executor: ExecutorProvider): Promise<OrchestrationResult> => {
      const loop_args = {
        req, executor, task_with_media, media, context_block,
        skill_names, system_base, runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
      };
      return loop_mode === "task"
        ? deps.run_task_loop(loop_args)
        : deps.run_agent_loop({ ...loop_args, history_lines });
    };

    const first = await run_loop(executor);

    // agent → task 에스컬레이션: agent 루프가 approval 필요 상황을 감지한 경우
    if (loop_mode === "agent" && is_agent_escalation(first.error)) {
      deps.logger.info("agent_escalation_to_task", { error: first.error, run_id: req.run_id });
      if (req.run_id) deps.process_tracker?.set_mode(req.run_id, "task");
      const task_args = {
        req, executor, task_with_media, media, context_block,
        skill_names, system_base, runtime_policy, tool_definitions, tool_ctx, skill_provider_prefs, request_scope,
      };
      const escalated = await deps.run_task_loop(task_args);
      return finalize(escalated);
    }

    if (first.reply || first.suppress_reply) return finalize(first);

    if (executor === "claude_code") {
      const fallback = resolve_executor_provider("chatgpt", deps.caps());
      if (fallback !== executor) {
        deps.logger.warn("executor failed, trying fallback", { executor, fallback, error: first.error });
        const second = await run_loop(fallback);
        if (second.reply || second.suppress_reply) return finalize(second);
        return finalize({ ...second, error: second.error || first.error });
      }
    }
    return finalize(first);
  } catch (e) {
    const msg = error_message(e);
    deps.logger.error("execute unhandled", { error: msg });
    return finalize(error_result(mode, null, msg));
  }
}
