/** 실행 runner 공통 의존성 + 인수 타입. */

import type { AgentRunResult } from "../../agent/agent.types.js";
import type { AgentBackendRegistry } from "../../agent/agent-registry.js";
import type { CompactionFlushConfig } from "../../agent/loop.js";
import type { AgentRuntimeLike } from "../../agent/runtime.types.js";
import type { ToolExecutionContext } from "../../agent/tools/types.js";
import type { StreamBuffer } from "../../channels/stream-buffer.js";
import type { RuntimeExecutionPolicy } from "../../providers/types.js";
import type { ProviderRegistry } from "../../providers/service.js";
import type { ExecutorProvider } from "../../providers/executor.js";
import type { Logger } from "../../logger.js";
import type { ProcessTrackerLike } from "../process-tracker.js";
import type { AppendWorkflowEventInput } from "../../events/index.js";
import type {
  AgentHooksBuilderDeps,
} from "../agent-hooks-builder.js";
import type { ToolCallHandlerDeps } from "../tool-call-handler.js";
import type { OrchestrationRequest, OrchestrationResult, ExecutionMode } from "../types.js";

/** run_once / run_agent_loop / run_task_loop / continue_task_loop 공통 인수. */
export type RunExecutionArgs = {
  req: OrchestrationRequest;
  executor: ExecutorProvider;
  task_with_media: string;
  context_block: string;
  skill_names: string[];
  system_base: string;
  runtime_policy: RuntimeExecutionPolicy;
  tool_definitions: Array<Record<string, unknown>>;
  tool_ctx: ToolExecutionContext;
  skill_provider_prefs?: string[];
  /** execute()에서 한 번 계산된 scope ID. run_task_loop에서 재사용. */
  request_scope: string;
  /** 사용자 지정 모델 ID. 미설정 시 프로바이더 기본값 사용. */
  preferred_model?: string;
};

export type StreamingConfig = {
  enabled: boolean;
  interval_ms: number;
  min_chars: number;
};

/** OrchestrationService에서 runner 함수로 전달되는 공유 의존성. */
export type RunnerDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  config: {
    agent_loop_max_turns: number;
    task_loop_max_turns: number;
    executor_provider: ExecutorProvider;
    max_tool_result_chars: number;
  };
  logger: Logger;
  agent_backends: AgentBackendRegistry | null;
  process_tracker: ProcessTrackerLike | null;
  get_mcp_configs: (() => Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>) | null;
  streaming_cfg: StreamingConfig;
  hooks_deps: AgentHooksBuilderDeps;
  tool_deps: ToolCallHandlerDeps;
  session_cd: { observe: (event: import("../../agent/agent.types.js").AgentEvent) => unknown };
  workspace: string | undefined;

  /** 모드에 맞는 시스템 프롬프트 overlay. */
  build_overlay: (mode: "once" | "agent") => string;
  /** 공통 AgentHooks 생성. tools_accumulator에 실행된 도구명이 누적됨. */
  hooks_for: (stream: StreamBuffer, args: { req: OrchestrationRequest; runtime_policy: RuntimeExecutionPolicy }, backend_id: string, task_id?: string, tools_accumulator?: string[]) => import("../../agent/agent.types.js").AgentHooks;
  /** 워크플로우 이벤트 기록. */
  log_event: (input: AppendWorkflowEventInput) => void;
  /** AgentRunResult → OrchestrationResult 변환. */
  convert_agent_result: (result: AgentRunResult, mode: ExecutionMode, stream: StreamBuffer, req: OrchestrationRequest) => OrchestrationResult;
  /** concierge 페르소나 어투를 followup 지시에 포함. */
  build_persona_followup: (concierge_heart: string) => string;
  /** 컨텍스트 압축 전 메모리 자동 저장 설정. */
  build_compaction_flush: () => CompactionFlushConfig | undefined;
};
