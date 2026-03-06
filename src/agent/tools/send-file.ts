/** 로컬 파일을 현재 채널/채팅에 전송하는 도구. */
import { basename } from "node:path";
import { Tool } from "./base.js";
import type { OutboundMessage } from "../../bus/types.js";
import { now_iso, short_id} from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { to_local_media_item } from "./media-utils.js";

export type SendFileCallback = (message: OutboundMessage) => Promise<void>;

export class SendFileTool extends Tool {
  readonly name = "send_file";
  readonly category = "file_transfer" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Send a local file (PDF, image, document, etc.) to the current channel/chat.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Local file path to send (absolute or relative to workspace)" },
      caption: { type: "string", description: "Optional message to accompany the file" },
    },
    required: ["file_path"],
    additionalProperties: false,
  };

  private send_callback: SendFileCallback | null;
  private default_channel: string;
  private default_chat_id: string;
  private readonly workspace_dir: string;

  constructor(args?: {
    send_callback?: SendFileCallback | null;
    default_channel?: string;
    default_chat_id?: string;
    workspace?: string;
  }) {
    super();
    this.send_callback = args?.send_callback || null;
    this.default_channel = args?.default_channel || "";
    this.default_chat_id = args?.default_chat_id || "";
    this.workspace_dir = args?.workspace || process.cwd();
  }

  set_context(channel: string, chat_id: string): void {
    this.default_channel = channel;
    this.default_chat_id = chat_id;
  }

  set_send_callback(callback: SendFileCallback): void {
    this.send_callback = callback;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (!this.send_callback) return "Error: send callback is not configured";
    const context = _context || {};
    const channel = String(context.channel || this.default_channel || "");
    const chat_id = String(context.chat_id || this.default_chat_id || "");
    if (!channel || !chat_id) return "Error: channel and chat_id are required";

    const file_path = String(params.file_path || "").trim();
    if (!file_path) return "Error: file_path is required";

    const media_item = to_local_media_item(file_path, this.workspace_dir);
    if (!media_item) return `Error: file not found or not accessible: ${file_path}`;

    const caption = String(params.caption || "").trim();
    const filename = basename(media_item.url);

    const message: OutboundMessage = {
      id: short_id(),
      provider: channel,
      channel,
      sender_id: String(context.sender_id || "agent"),
      chat_id,
      content: caption || filename,
      at: now_iso(),
      media: [media_item],
      metadata: { kind: "file_delivery" },
    };

    await this.send_callback(message);
    return `file_sent: ${filename} (${media_item.type})`;
  }
}
