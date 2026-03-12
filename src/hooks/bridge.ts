/**
 * HookRunner ↔ 기존 PreToolHook/PostToolHook 브리지.
 * 기존 도구 실행 파이프라인에 사용자 정의 훅을 삽입.
 */

import type { PreToolHook, PostToolHook, ToolHookDecision, ToolExecutionContext } from "../agent/tools/types.js";
import type { HookRunner } from "./runner.js";

/**
 * HookRunner를 PreToolHook으로 변환.
 * PreToolUse 이벤트를 발사하고, deny 결정이 있으면 도구 실행을 차단.
 */
export function hook_runner_to_pre_tool_hook(
  runner: HookRunner,
  session_id?: string,
): PreToolHook {
  return async (tool_name, params, context?: ToolExecutionContext): Promise<ToolHookDecision> => {
    if (!runner.has("PreToolUse")) return { permission: "allow" };

    const results = await runner.fire("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id,
      cwd: undefined,
      tool_name,
      tool_input: params,
      metadata: context ? { task_id: context.task_id, channel: context.channel } : undefined,
    });

    // deny는 updated_input보다 우선 — 먼저 전체를 순회하여 차단 여부 확인
    for (const r of results) {
      if (r.output.decision === "deny") {
        return { permission: "deny", reason: r.output.reason || `blocked by hook: ${r.hook_name}` };
      }
    }
    for (const r of results) {
      if (r.output.updated_input) {
        return { permission: "allow", updated_params: r.output.updated_input };
      }
    }
    return { permission: "allow" };
  };
}

/**
 * HookRunner를 PostToolHook으로 변환.
 * PostToolUse / PostToolUseFailure 이벤트를 발사.
 */
export function hook_runner_to_post_tool_hook(
  runner: HookRunner,
  session_id?: string,
): PostToolHook {
  return async (tool_name, params, result, context?: ToolExecutionContext, is_error?: boolean): Promise<void> => {
    const event = is_error ? "PostToolUseFailure" : "PostToolUse";
    if (!runner.has(event)) return;

    await runner.fire(event, {
      hook_event_name: event,
      session_id,
      tool_name,
      tool_input: params,
      tool_output: result,
      is_error,
      metadata: context ? { task_id: context.task_id, channel: context.channel } : undefined,
    });
  };
}
