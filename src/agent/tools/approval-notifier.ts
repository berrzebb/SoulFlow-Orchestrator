/** 승인 요청 알림 메시지 조립 + 발행. create_default_tool_registry의 SRP 분리. */

import type { MessageBusLike, OutboundMessage } from "../../bus/index.js";
import type { AppendWorkflowEventInput, AppendWorkflowEventResult } from "../../events/types.js";
import { now_iso } from "../../utils/common.js";
import { redact_sensitive_unknown } from "../../security/sensitive.js";

type ApprovalRequest = {
  request_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  context?: { channel?: string; chat_id?: string; task_id?: string; sender_id?: string };
  detail: string;
  created_at: string;
};

export type ApprovalNotifierDeps = {
  bus: MessageBusLike;
  event_recorder?: ((event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>) | null;
};

/** 승인 알림 콜백 팩토리. */
export function build_approval_notifier(deps: ApprovalNotifierDeps): (request: ApprovalRequest) => Promise<void> {
  return async (request) => {
    const channel = String(request.context?.channel || "");
    const chat_id = String(request.context?.chat_id || "");
    if (!channel || !chat_id) return;

    const safe_params = redact_sensitive_unknown(request.params) as Record<string, unknown>;
    const run_id = String(request.context?.task_id || `run-${Date.now()}`);
    const task_id = String(request.context?.task_id || "task-unspecified");
    const agent_id = String(request.context?.sender_id || "agent");

    const orchestrator_event = {
      event_id: request.request_id,
      run_id,
      task_id,
      agent_id,
      phase: "approval" as const,
      summary: `${request.tool_name} approval required`,
      payload: { tool: request.tool_name, params: safe_params },
      provider: channel,
      channel,
      chat_id,
      source: "outbound" as const,
      at: now_iso(),
    };

    const message: OutboundMessage = {
      id: `approval-${request.request_id}`,
      provider: channel,
      channel,
      sender_id: "approval-bot",
      chat_id,
      at: now_iso(),
      content: [
        "🔐 **승인 요청**",
        "",
        `**도구:** ${request.tool_name}`,
        `**사유:** ${request.detail.split("\n")[0] || "restricted operation"}`,
        ...format_params_block(safe_params),
        "",
        "다음 중 하나를 답장해주세요:",
        "• `승인` / `yes` — 이 요청을 승인",
        "• `모두 승인` — 이 세션의 동일 도구 요청을 모두 자동 승인",
        "• `거부` / `no` — 이 요청을 거부",
        "• `보류` / `later` — 나중에 결정",
        "",
        "_이 메시지에 답장하면 작업이 자동으로 재개됩니다._",
      ].join("\n"),
      metadata: {
        kind: "approval_request",
        orchestrator_event,
        request_id: request.request_id,
        tool_name: request.tool_name,
        params: safe_params,
        created_at: request.created_at,
      },
    };

    if (deps.event_recorder) {
      try {
        await deps.event_recorder({
          ...orchestrator_event,
          detail: request.detail,
        });
      } catch {
        // keep approval flow non-blocking even if event storage fails
      }
    }

    await deps.bus.publish_outbound(message);
  };
}

/** 파라미터를 판단 근거로 표시할 수 있는 메시지 블록으로 변환. */
function format_params_block(params: Record<string, unknown>): string[] {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return [];
  const lines = entries.slice(0, 8).map(([k, v]) => {
    const val = typeof v === "string" ? v : JSON.stringify(v);
    return `  • \`${k}\`: ${String(val).slice(0, 200)}`;
  });
  return ["**파라미터:**", ...lines];
}
