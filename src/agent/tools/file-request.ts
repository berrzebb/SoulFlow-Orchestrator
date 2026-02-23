import { randomUUID } from "node:crypto";
import { Tool } from "./base.js";
import type { OutboundMessage } from "../../bus/types.js";
import { now_iso } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export type FileRequestCallback = (message: OutboundMessage) => Promise<void>;

export class FileRequestTool extends Tool {
  readonly name = "request_file";
  readonly description = "Request file upload from user in current channel/chat.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Request message shown to user" },
      channel: { type: "string", description: "Target channel id" },
      chat_id: { type: "string", description: "Target chat id" },
      accept: {
        type: "array",
        items: { type: "string" },
        description: "Optional accepted file types, e.g. ['csv','png','pdf']",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  };

  private send_callback: FileRequestCallback | null;
  private default_channel: string;
  private default_chat_id: string;

  constructor(args?: {
    send_callback?: FileRequestCallback | null;
    default_channel?: string;
    default_chat_id?: string;
  }) {
    super();
    this.send_callback = args?.send_callback || null;
    this.default_channel = args?.default_channel || "";
    this.default_chat_id = args?.default_chat_id || "";
  }

  set_context(channel: string, chat_id: string): void {
    this.default_channel = channel;
    this.default_chat_id = chat_id;
  }

  set_send_callback(callback: FileRequestCallback): void {
    this.send_callback = callback;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (!this.send_callback) return "Error: send callback is not configured";
    const channel = String(params.channel || this.default_channel || "");
    const chat_id = String(params.chat_id || this.default_chat_id || "");
    const prompt = String(params.prompt || "").trim();
    const accept = Array.isArray(params.accept) ? params.accept.map((v) => String(v || "").trim()).filter(Boolean) : [];
    if (!channel || !chat_id) return "Error: channel and chat_id are required";
    if (!prompt) return "Error: prompt is required";

    const request_id = randomUUID().slice(0, 12);
    const content = [
      `[FILE_REQUEST id=${request_id}]`,
      prompt,
      accept.length > 0 ? `accepted_types: ${accept.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const message: OutboundMessage = {
      id: randomUUID().slice(0, 12),
      provider: channel,
      channel,
      sender_id: "agent",
      chat_id,
      content,
      at: now_iso(),
      metadata: {
        kind: "file_request",
        request_id,
        accept,
      },
    };

    await this.send_callback(message);
    return `file_request_sent:${request_id}`;
  }
}

