/**
 * Gateway — 메시지 분류 → 실행 결정.
 * 오케스트레이터 LLM 분류기를 호출하여 builtin/inquiry/execute 중 하나로 라우팅.
 * 실행 자체는 하지 않으며 OrchestrationService가 결정을 소비.
 */

import type { ExecutionMode } from "./types.js";
import type { ClassifierContext } from "./classifier.js";
import { classify_execution_mode } from "./classifier.js";
import { format_active_task_summary } from "./prompts.js";
import { resolve_executor_provider, type ExecutorProvider, type ProviderCapabilities } from "../providers/executor.js";
import type { ProviderRegistry } from "../providers/service.js";
import type { Logger } from "../logger.js";
import type { TaskState } from "../contracts.js";
import type { AgentSession } from "../agent/agent.types.js";

export type GatewayDecision =
  | { action: "builtin"; command: string; args?: string }
  | { action: "inquiry"; summary: string }
  | { action: "execute"; mode: ExecutionMode; executor: ExecutorProvider; workflow_id?: string };

export type GatewayDeps = {
  providers: ProviderRegistry;
  provider_caps: ProviderCapabilities;
  executor_preference: ExecutorProvider;
  session_lookup: (task_id: string) => AgentSession | null;
  logger: Logger;
};

/** 메시지 분류 → 실행 결정을 반환. 실행 자체는 하지 않음. */
export async function resolve_gateway(
  task: string,
  ctx: ClassifierContext,
  active_tasks: TaskState[],
  deps: GatewayDeps,
): Promise<GatewayDecision> {
  const classification = await classify_execution_mode(
    task, ctx, deps.providers, deps.logger,
  );

  // builtin: 커맨드 핸들러로 직접 위임
  if (classification.mode === "builtin") {
    return { action: "builtin", command: classification.command, args: classification.args };
  }

  // inquiry: 활성 태스크가 있으면 요약 응답, 없으면 once로 폴백
  if (classification.mode === "inquiry" && active_tasks.length > 0) {
    deps.logger.info("inquiry_shortcircuit", { count: active_tasks.length });
    return { action: "inquiry", summary: format_active_task_summary(active_tasks, deps.session_lookup) };
  }

  // phase: phase 모드로 직접 라우팅 (tool_loop 불필요)
  if (classification.mode === "phase") {
    const executor = resolve_executor_provider(deps.executor_preference, deps.provider_caps);
    const workflow_id = "workflow_id" in classification ? classification.workflow_id : undefined;
    return { action: "execute", mode: "phase", executor, workflow_id };
  }

  // 실행 모드 결정
  let mode: ExecutionMode = classification.mode === "inquiry" ? "once" : classification.mode;
  const executor = resolve_executor_provider(deps.executor_preference, deps.provider_caps);

  // tool_loop 미지원 프로바이더 → once로 다운그레이드
  if (mode !== "once" && !deps.providers.supports_tool_loop(executor)) {
    deps.logger.info("mode_downgrade", { original: mode, executor, reason: "no_tool_loop" });
    mode = "once";
  }

  return { action: "execute", mode, executor };
}
