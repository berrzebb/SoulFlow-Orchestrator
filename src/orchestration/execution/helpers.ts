/** 오케스트레이션 실행 공통 헬퍼: 결과 생성자, 요청 컨텍스트 빌더, 유틸리티. */

import type { InboundMessage } from "../../bus/types.js";
import { resolve_reply_to } from "../../channels/types.js";
import type { ToolExecutionContext } from "../../agent/tools/types.js";
import type { ExecutionMode, OrchestrationRequest, OrchestrationResult, ResultUsage } from "../types.js";
import type { StreamBuffer } from "../../channels/stream-buffer.js";
import { now_ms } from "../../utils/common.js";

// ── 결과 생성자 ──

export function error_result(mode: ExecutionMode, stream: StreamBuffer | null, error: string, tool_calls_count = 0): OrchestrationResult {
  return { reply: null, error, mode, tool_calls_count, streamed: stream?.has_streamed() ?? false, stream_full_content: stream?.get_full_content() };
}

export function suppress_result(mode: ExecutionMode, stream: StreamBuffer, tool_calls_count = 0): OrchestrationResult {
  return { reply: null, suppress_reply: true, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content() };
}

export function reply_result(mode: ExecutionMode, stream: StreamBuffer, reply: string | null, tool_calls_count = 0, parsed_output?: unknown, usage?: ResultUsage): OrchestrationResult {
  return { reply, mode, tool_calls_count, streamed: stream.has_streamed(), stream_full_content: stream.get_full_content(), parsed_output, usage };
}

export function append_no_tool_notice(reply: string): string {
  return `${reply}\n\n_(작업이 완료되었습니다. 추가 요청이 있으면 말씀해주세요.)_`;
}

export function extract_usage(raw: Record<string, unknown> | undefined): ResultUsage | undefined {
  if (!raw) return undefined;
  const prompt = Number(raw.prompt_tokens || 0);
  const completion = Number(raw.completion_tokens || 0);
  const total = Number(raw.total_tokens || 0);
  const cost = Number(raw.total_cost_usd || 0);
  if (!prompt && !completion && !total && !cost) return undefined;
  return {
    ...(prompt ? { prompt_tokens: prompt } : {}),
    ...(completion ? { completion_tokens: completion } : {}),
    ...(total ? { total_tokens: total } : {}),
    ...(cost ? { total_cost_usd: cost } : {}),
  };
}

// ── 요청 컨텍스트 빌더 ──

export function build_tool_context(req: OrchestrationRequest, task_id: string): ToolExecutionContext {
  return {
    task_id,
    signal: req.signal,
    channel: req.provider,
    chat_id: req.message.chat_id,
    sender_id: req.message.sender_id,
    reply_to: resolve_reply_to(req.provider, req.message) || undefined,
  };
}

export function compose_task_with_media(task: string, media: string[]): string {
  if (!media.length) return task;
  const lines = media.map((m, i) => `${i + 1}. ${m}`);
  return [
    task || "첨부 파일을 분석하세요.",
    "", "[ATTACHED_FILES]", ...lines, "",
    "요구사항:", "- 첨부 파일을 우선 분석하고 핵심 결과를 요약할 것", "- 표/코드/로그가 포함되면 핵심만 구조화해 보고할 것",
  ].join("\n");
}

export function build_context_message(task_with_media: string): string {
  return `[CURRENT_REQUEST]\n${task_with_media}`;
}

export { resolve_reply_to };

export function raw_message_id(message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  return String(meta.message_id || message.id || "").trim();
}

const RE_SCOPE_INVALID = /[^a-zA-Z0-9._-]+/g;
const RE_MULTI_DASH = /-+/g;

export function inbound_scope_id(message: InboundMessage): string {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  const raw = String(meta.message_id || message.id || "").trim();
  if (!raw) return `msg-${now_ms()}`;
  RE_SCOPE_INVALID.lastIndex = 0;
  RE_MULTI_DASH.lastIndex = 0;
  return raw.replace(RE_SCOPE_INVALID, "-").replace(RE_MULTI_DASH, "-").slice(0, 96) || `msg-${now_ms()}`;
}

// ── HITL 포맷 ──

export type HitlType = "choice" | "confirmation" | "question" | "escalation" | "error";

export function format_hitl_prompt(agent_prompt: string, _task_id: string, type: HitlType = "choice"): string {
  const cleaned = (agent_prompt || "")
    .replace(/__request_user_choice__/g, "")
    .replace(/\[ASK_USER\]/g, "")
    .replace(/^ask_user_sent:\S+$/gm, "")
    .replace(/^question:\s.+$/gm, "")
    .trim();
  const body = cleaned || "추가 정보가 필요합니다.";
  const guide = HITL_GUIDE[type];
  return [
    guide.header,
    "",
    body,
    "",
    guide.instruction,
    "",
    "_이 메시지에 답장하면 작업이 자동으로 재개됩니다._",
  ].join("\n");
}

const HITL_GUIDE: Record<HitlType, { header: string; instruction: string }> = {
  choice: {
    header: "💬 **선택 요청**",
    instruction: "위 선택지 중 하나를 골라 답장해주세요.",
  },
  confirmation: {
    header: "💬 **확인 요청**",
    instruction: "`예` 또는 `아니오`로 답장해주세요.",
  },
  question: {
    header: "💬 **질문**",
    instruction: "질문에 대한 답변을 답장해주세요.",
  },
  escalation: {
    header: "⚠️ **판단 필요**",
    instruction: [
      "다음 중 하나를 답장해주세요:",
      "• 구체적인 지시사항을 입력하면 해당 내용으로 재시도합니다",
      "• `계속` — 현재 결과를 수용하고 다음 단계로 진행",
      "• `취소` — 워크플로우를 중단합니다",
    ].join("\n"),
  },
  error: {
    header: "❌ **작업 실패**",
    instruction: [
      "다음 중 하나를 답장해주세요:",
      "• 추가 정보나 수정 지시를 입력하면 해당 내용을 포함하여 재시도합니다",
      "• `재시도` — 동일 조건으로 다시 실행합니다",
      "• `취소` — 작업을 종료합니다",
    ].join("\n"),
  },
};

export function detect_hitl_type(prompt: string): HitlType {
  if (!prompt) return "question";
  if (/진행할까요|계속할까요|실행할까요|괜찮을까요|할까요\?|맞나요\?|맞습니까\?/.test(prompt)
    || /\b(yes\s*\/\s*no|y\s*\/\s*n)\b/i.test(prompt)) {
    return "confirmation";
  }
  const numbered = prompt.match(/(?:^|\n)\s*(?:\d+[.)]\s|[①-⑳]\s|[-•*]\s)/g);
  if (numbered && numbered.length >= 2) return "choice";
  return "question";
}
