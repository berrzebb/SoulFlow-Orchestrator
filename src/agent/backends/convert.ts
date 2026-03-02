import { now_iso } from "../../utils/common.js";
import type { ApprovalMode, ChatMessage, ChatOptions, LlmResponse, SandboxPolicy } from "../../providers/types.js";
import type { AgentBackendId, AgentRunOptions, AgentRunResult, AgentSession } from "../agent.types.js";

/** AgentRunOptions → ChatMessage[] + ChatOptions 변환. CLI 백엔드용. */
export function agent_options_to_chat(options: AgentRunOptions): {
  messages: ChatMessage[];
  chat_options: Partial<ChatOptions>;
} {
  const messages: ChatMessage[] = [];
  if (options.system_prompt) {
    messages.push({ role: "system", content: options.system_prompt });
  }
  messages.push({ role: "user", content: options.task });

  const chat_options: Partial<ChatOptions> = {
    tools: options.tools as unknown as Record<string, unknown>[],
    runtime_policy: options.runtime_policy,
    model: options.model,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    effort: options.effort,
    on_stream: options.hooks?.on_stream,
    abort_signal: options.abort_signal,
  };
  return { messages, chat_options };
}

/** LlmResponse → AgentRunResult 변환. CLI 백엔드용. */
export function llm_response_to_agent_result(
  response: LlmResponse,
  backend_id: AgentBackendId,
): AgentRunResult {
  const session_id = String(
    response.metadata?.session_id || response.metadata?.thread_id || "",
  ).trim();

  const session: AgentSession | null = session_id
    ? { session_id, backend: backend_id, created_at: now_iso() }
    : null;

  const finish_reason: import("../agent.types.js").AgentFinishReason =
    response.finish_reason === "error" ? "error"
    : (response.finish_reason === "length" || response.finish_reason === "max_tokens") ? "max_tokens"
    : "stop";

  return {
    content: response.content,
    session,
    tool_calls_count: response.tool_calls.length,
    usage: response.usage,
    finish_reason,
    metadata: {
      ...response.metadata,
      raw_tool_calls: response.has_tool_calls ? response.tool_calls : undefined,
      raw_finish_reason: response.finish_reason,
    },
  };
}

/** SandboxPolicy → Claude SDK permissionMode + dangerous skip 매핑. */
export function sandbox_to_sdk_permission(policy: SandboxPolicy): {
  permission_mode: string;
  dangerous_skip: boolean;
} {
  if (policy.plan_only) return { permission_mode: "plan", dangerous_skip: false };
  switch (policy.fs_access) {
    case "read-only": return { permission_mode: "default", dangerous_skip: false };
    case "workspace-write": return { permission_mode: "acceptEdits", dangerous_skip: false };
    case "full-access": return { permission_mode: "bypassPermissions", dangerous_skip: true };
  }
}

/** SandboxPolicy → Codex thread/start 파라미터. sandbox는 camelCase 문자열, sandboxPolicy는 per-turn 객체. */
export function sandbox_to_codex_policy(policy: SandboxPolicy, cwd: string): {
  /** thread/start.sandbox — "readOnly" | "workspaceWrite" | "dangerFullAccess" */
  sandbox: string;
  /** thread/start.approvalPolicy — "unlessTrusted" | "onRequest" | "never" */
  approval_policy: string;
  /** turn/start.sandboxPolicy — 세밀한 per-turn 샌드박스 (writableRoots, networkAccess 포함) */
  turn_sandbox_policy?: Record<string, unknown>;
} {
  const APPROVAL_MAP: Record<ApprovalMode, string> = {
    "always-ask": "unlessTrusted",
    "auto-approve": "never",
    "trusted-only": "onRequest",
  };
  const approval_policy = APPROVAL_MAP[policy.approval];

  switch (policy.fs_access) {
    case "read-only":
      return { sandbox: "readOnly", approval_policy };
    case "workspace-write":
      return {
        sandbox: "workspaceWrite",
        approval_policy,
        turn_sandbox_policy: {
          type: "workspaceWrite",
          writableRoots: [cwd, ...(policy.writable_roots || [])],
          networkAccess: policy.network_access,
        },
      };
    case "full-access":
      return { sandbox: "dangerFullAccess", approval_policy };
  }
}

/** SDK result subtype → AgentFinishReason 정밀 매핑. */
export function sdk_result_subtype_to_finish_reason(
  subtype: string,
): import("../agent.types.js").AgentFinishReason {
  switch (subtype) {
    case "success": return "stop";
    case "error_max_turns": return "max_turns";
    case "error_max_budget_usd": return "max_budget";
    case "error_max_structured_output_retries": return "output_retries";
    case "error_during_execution": return "error";
    default: return "error";
  }
}

/** AgentRunOptions.effort → Codex effort 레벨 변환. Codex는 "low"|"medium"|"high"만 지원. */
export function effort_to_codex(effort?: string): string | undefined {
  if (!effort) return undefined;
  const MAP: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "high" };
  return MAP[effort] || effort;
}

