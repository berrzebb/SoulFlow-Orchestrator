import { randomUUID } from "node:crypto";
import { Tool } from "./base.js";
import type { OutboundMessage } from "../../bus/types.js";
import { now_iso } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export type MessageSendCallback = (message: OutboundMessage) => Promise<void>;

export class MessageTool extends Tool {
  readonly name = "message";
  readonly description = "Send a message through an outbound channel callback.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      content: { type: "string", description: "Message content" },
      channel: { type: "string", description: "Target channel id" },
      chat_id: { type: "string", description: "Target chat id" },
      reply_to: { type: "string", description: "Optional reply-to id" },
      media: {
        type: "array",
        items: { type: "string" },
        description: "Optional media URLs or file references",
      },
    },
    required: ["content"],
    additionalProperties: false,
  };
  private send_callback: MessageSendCallback | null;
  private default_channel: string;
  private default_chat_id: string;
  private default_reply_to: string | null;
  private sent_in_turn = false;

  constructor(args?: {
    send_callback?: MessageSendCallback | null;
    default_channel?: string;
    default_chat_id?: string;
    default_reply_to?: string | null;
  }) {
    super();
    this.send_callback = args?.send_callback || null;
    this.default_channel = args?.default_channel || "";
    this.default_chat_id = args?.default_chat_id || "";
    this.default_reply_to = args?.default_reply_to || null;
  }

  set_context(channel: string, chat_id: string, reply_to?: string | null): void {
    this.default_channel = channel;
    this.default_chat_id = chat_id;
    this.default_reply_to = reply_to || null;
  }

  set_send_callback(callback: MessageSendCallback): void {
    this.send_callback = callback;
  }

  start_turn(): void {
    this.sent_in_turn = false;
  }

  has_sent_in_turn(): boolean {
    return this.sent_in_turn;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (!this.send_callback) return "Error: send callback is not configured";
    const channel = String(params.channel || this.default_channel || "");
    const chat_id = String(params.chat_id || this.default_chat_id || "");
    if (!channel || !chat_id) return "Error: channel and chat_id are required";
    const content = String(params.content || "");
    const media_raw = Array.isArray(params.media) ? params.media : [];
    const media_urls = media_raw.map((m) => String(m)).filter(Boolean);
    const message: OutboundMessage = {
      id: randomUUID().slice(0, 12),
      provider: channel,
      channel,
      sender_id: "agent",
      chat_id,
      content,
      at: now_iso(),
      reply_to: params.reply_to ? String(params.reply_to) : this.default_reply_to || undefined,
      media: media_urls.map((url) => ({ type: "link", url })),
      metadata: {},
    };
    await this.send_callback(message);
    this.sent_in_turn = true;
    return `Message sent to ${channel}:${chat_id}`;
  }
}

