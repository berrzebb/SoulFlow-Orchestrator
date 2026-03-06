/**
 * AskUserTool — 워크플로우 실행 중 원본 채널에 HITL 요청을 보내는 도구.
 *
 * 에이전트가 사용자 확인/선택/추가 정보가 필요할 때 호출.
 * 채널에 질문 메시지를 발행하고 "__request_user_choice__" 마커를 반환하여
 * task loop가 waiting_user_input 상태로 전환되도록 함.
 */
import { Tool } from "./base.js";
import type { OutboundMessage } from "../../bus/types.js";
import { now_iso, short_id } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export type AskUserSendCallback = (message: OutboundMessage) => Promise<void>;

/** __request_user_choice__: service.ts에서 감지하여 waiting_user_input 전환. */
const HITL_MARKER = "__request_user_choice__";

export class AskUserTool extends Tool {
  readonly name = "ask_user";
  readonly category = "messaging" as const;
  readonly description =
    "Ask the user a question or request confirmation through the originating channel. " +
    "The task will pause until the user responds. " +
    "Use this when you need user input, confirmation, or a choice to continue.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question or prompt to show to the user",
      },
      choices: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of choices (e.g. ['Option A', 'Option B']). If provided, the user can reply with the choice number.",
      },
      context: {
        type: "string",
        description: "Optional brief context explaining why this input is needed",
      },
    },
    required: ["question"],
    additionalProperties: false,
  };

  private send_callback: AskUserSendCallback | null;

  constructor(args?: { send_callback?: AskUserSendCallback | null }) {
    super();
    this.send_callback = args?.send_callback || null;
  }

  set_send_callback(callback: AskUserSendCallback): void {
    this.send_callback = callback;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (!this.send_callback) return "Error: send callback is not configured";
    const ctx = _context || {};
    const channel = String(ctx.channel || "");
    const chat_id = String(ctx.chat_id || "");
    if (!channel || !chat_id) return "Error: channel and chat_id are required (no originating channel context)";

    const question = String(params.question || "").trim();
    if (!question) return "Error: question is required";

    const choices = Array.isArray(params.choices)
      ? params.choices.map((v) => String(v || "").trim()).filter(Boolean)
      : [];
    const context_text = String(params.context || "").trim();
    const request_id = short_id();

    const lines: string[] = [];
    if (context_text) lines.push(`_${context_text}_`, "");
    lines.push(question);
    if (choices.length > 0) {
      lines.push("");
      choices.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
      lines.push("", "번호 또는 내용으로 답장해주세요.");
    }

    const message: OutboundMessage = {
      id: `ask-${request_id}`,
      provider: channel,
      channel,
      sender_id: ctx.sender_id || "agent",
      chat_id,
      content: lines.join("\n"),
      reply_to: ctx.reply_to || undefined,
      at: now_iso(),
      metadata: {
        kind: "ask_user",
        request_id,
        task_id: ctx.task_id || undefined,
        choices: choices.length > 0 ? choices : undefined,
      },
    };

    await this.send_callback(message);
    // 마커를 포함하여 task loop가 waiting_user_input으로 전환되도록 함
    return `${HITL_MARKER}\nask_user_sent:${request_id}\nquestion: ${question}`;
  }
}
