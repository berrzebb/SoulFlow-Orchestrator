/** Phase 4.5: Execute Dispatcher — gateway 라우팅 → short-circuit → mode 분기 → finalize
 *
 * execute() 초반부의 preflight 이후 dispatcher 로직을 한 곳으로 수렴.
 * gateway 결정 → identity/builtin/inquiry short-circuit → phase/once/agent/task 분기 → finalize
 */

import type { RunExecutionArgs } from "./runner-deps.js";
import type { OrchestrationRequest, OrchestrationResult } from "../types.js";
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
import { is_once_escalation, is_agent_escalation } from "../classifier.js";
import { error_result } from "./helpers.js";
import { generate_completion_checks, format_follow_up } from "../completion-checker.js";
import { build_session_evidence, format_reuse_reply, evaluate_reuse } from "../guardrails/index.js";
import { now_ms } from "../../utils/common.js";

const VALIDATION_ROLES = new Set(["validator", "reviewer"]);

export type ExecuteDispatcherDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;
  config: {
    executor_provider: ExecutorProvider;
    provider_caps?: ProviderCapabilities;
    /** EG-3: session reuse freshness window (ms). 0 = 비활성. */
    freshness_window_ms?: number;
  };
  process_tracker: ProcessTrackerLike | null;
  guard: ConfirmationGuard | null;
  tool_index: import("../tool-index.js").ToolIndex | null;
  log_event: (input: AppendWorkflowEventInput) => void;
  build_identity_reply: () => string;
  build_system_prompt: (names: string[], provider: string, chat_id: string, cats?: ReadonlySet<string>, alias?: string) => Promise<string>;
  generate_guard_summary: (task_text: string) => Promise<string>;
  run_once: (args: RunExecutionArgs) => Promise<OrchestrationResult>;
  run_agent_loop: (args: RunExecutionArgs & { media: string[] }) => Promise<OrchestrationResult>;
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
    request_scope, evt_base,
    context_block, tool_ctx, skill_tool_names, skill_provider_prefs,
    category_map, tool_categories, active_tasks_in_chat,
  } = preflight;

  // warm_up은 비동기 fire-and-forget: gateway를 블로킹하지 않음
  // select_tools_for_request 호출 시점에 완료되어 있으면 캐시 활용, 아니면 그때 임베딩
  deps.tool_index?.warm_up(task_with_media).catch(() => {});

  const decision = await resolve_gateway(
    task_with_media,
    {
      active_tasks: active_tasks_in_chat,
      recent_history: req.session_history.slice(-6),
      available_tool_categories: tool_categories,
      available_skills: skill_names.map(name => {
        const meta = deps.runtime.get_context_builder().skills_loader.get_skill_metadata(name);
        return meta
          ? { name, summary: meta.summary, triggers: meta.triggers, aliases: meta.aliases }
          : { name, summary: "", triggers: [], aliases: [] };
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

  const { mode } = decision;

  // EG-3: session reuse short-circuit — phase 제외, once/agent/task 모드에서만 판단
  if (mode !== "phase") {
    const fw = deps.config.freshness_window_ms ?? 0;
    if (fw > 0 && req.session_history.length > 1) {
      const evidence = build_session_evidence(req.session_history, now_ms(), fw);
      const reuse = evaluate_reuse(task_with_media, evidence, now_ms(), { freshness_window_ms: fw, similarity_threshold: 0.85 });
      if (reuse.kind === "reuse_summary" || reuse.kind === "same_topic") {
        deps.log_event({ ...evt_base, phase: "done", summary: `session_reuse: ${reuse.kind}`, payload: { kind: reuse.kind, matched: reuse.matched_query } });
        return { reply: format_reuse_reply(reuse), mode: "once", tool_calls_count: 0, streamed: false, stop_reason: `session_reuse:${reuse.kind}` };
      }
    }
  }
  // 사용자 지정 프로바이더가 있으면 gateway 선택을 오버라이드
  const executor = (req.preferred_provider_id as import("../../providers/executor.js").ExecutorProvider | undefined) ?? decision.executor;

  // finalize: done/blocked 이벤트 기록 + process tracker 종료 + completion check 추가 (검증 역할 전용)
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
    // 검증 역할(validator, reviewer)일 때만 완료 체크리스트 추가
    if (result.reply && !result.error && req.alias && VALIDATION_ROLES.has(req.alias)) {
      const skill_metas = (result.matched_skills ?? [])
        .map((n) => deps.runtime.get_skill_metadata(n))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const { questions } = generate_completion_checks(
        result.tools_used ?? [], skill_metas, result.tool_calls_count, true,
      );
      const follow_up = format_follow_up(questions);
      if (follow_up) return { ...result, reply: `${result.reply}\n\n${follow_up}` };
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
    all_tool_definitions, task_with_media, mode, skill_tool_names, classifier_cats, category_map, undefined, deps.tool_index,
  );
  const system_base = req.system_prompt_override
    ?? await deps.build_system_prompt(skill_names, req.provider, req.message.chat_id, new Set(categories), req.alias);
  deps.logger.info("dispatch", { mode, executor, skills: skill_names, tool_count: tool_definitions.length, system_override: !!req.system_prompt_override });

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
      // 도구 카테고리가 지정되지 않은 once 요청 → 도구 없이 먼저 시도.
      // LLM이 도구가 필요하면 "NEED AGENT LOOP"를 출력 → 에스컬레이션 후 전체 도구 제공.
      const once_tools = classifier_cats?.length ? tool_definitions : [];
      // follow-up 감지(classifier_cats 존재) 또는 짧은 메시지(≤10 토큰) 시 히스토리 주입.
      // 메모리 섹션만으론 LLM이 짧은 참조 메시지("기준으로", "그거 다시" 등)의 맥락을 놓침.
      // session_history의 마지막은 record_user()가 방금 저장한 현재 요청 메시지.
      // context_block에 이미 포함되어 있으므로 제외하지 않으면 연속 user 메시지 중복이 발생.
      const history_for_turns = req.session_history.slice(0, -1);
      const msg_tokens = (req.message.content ?? "").trim().split(/\s+/).filter(Boolean).length;
      const is_short = msg_tokens <= 10;
      const recent_session_turns = history_for_turns.length > 0 && (classifier_cats?.length || is_short)
        ? history_for_turns.slice(-4)
        : undefined;
      const once_result = await deps.run_once({
        req, executor, task_with_media, context_block, skill_names, system_base,
        runtime_policy, tool_definitions: once_tools, tool_ctx, skill_provider_prefs, request_scope,
        preferred_model: req.preferred_model,
        recent_session_turns,
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
        preferred_model: req.preferred_model,
      };
      return loop_mode === "task"
        ? deps.run_task_loop(loop_args)
        : deps.run_agent_loop(loop_args);
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
