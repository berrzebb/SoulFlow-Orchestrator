import { Tool } from "./base.js";
import type { MediaItem, OutboundMessage } from "../../bus/types.js";
import { now_iso, normalize_text, error_message, short_id} from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { normalize_phase, type AppendWorkflowEventInput, type AppendWorkflowEventResult } from "../../events/types.js";
import { to_local_media_item } from "./media-utils.js";

export type MessageSendCallback = (message: OutboundMessage) => Promise<void>;
export type MessageEventRecordCallback = (event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>;

export class MessageTool extends Tool {
  readonly name = "message";
  readonly category = "messaging" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Send a phase event message (`assign/progress/blocked/done/approval`) through channel callback.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      content: { type: "string", description: "Message content" },
      phase: {
        type: "string",
        enum: ["assign", "progress", "blocked", "done", "approval"],
        description: "Workflow phase",
      },
      task_id: { type: "string", description: "Task id (used for workflow detail key)" },
      run_id: { type: "string", description: "Run id for correlated events" },
      event_id: { type: "string", description: "Idempotent event id (optional)" },
      agent_id: { type: "string", description: "Agent id/alias for the event producer" },
      detail: { type: "string", description: "Detailed body to append to workflow detail store (sqlite://events/task_details/<task_id>)" },
      payload: { type: "object", description: "Structured event payload" },
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
  private event_recorder: MessageEventRecordCallback | null;
  private readonly workspace_dir: string;
  private sent_in_turn = false;

  constructor(args: {
    send_callback?: MessageSendCallback | null;
    event_recorder?: MessageEventRecordCallback | null;
    workspace: string;
  }) {
    super();
    this.send_callback = args.send_callback || null;
    this.event_recorder = args.event_recorder || null;
    this.workspace_dir = args.workspace;
  }

  set_send_callback(callback: MessageSendCallback): void {
    this.send_callback = callback;
  }

  set_event_recorder(callback: MessageEventRecordCallback): void {
    this.event_recorder = callback;
  }

  start_turn(): void {
    this.sent_in_turn = false;
  }

  has_sent_in_turn(): boolean {
    return this.sent_in_turn;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    if (!this.send_callback) return "Error: send callback is not configured";
    const context = _context || {};
    const channel = String(params.channel || context.channel || "");
    const chat_id = String(params.chat_id || context.chat_id || "");
    if (!channel || !chat_id) return "Error: channel and chat_id are required";
    const phase = normalize_phase(params.phase);
    const detail = String(params.detail || "").trim();
    let content = String(params.content || "").trim();
    if (!content && detail) {
      content = detail.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean)[0] || "";
    }
    if (!content) return "Error: content or detail is required";
    const task_id = normalize_text(params.task_id || _context?.task_id || "task-unspecified");
    const run_id = normalize_text(params.run_id || `run-${Date.now()}`);
    const event_id = normalize_text(params.event_id || short_id());
    const agent_id = normalize_text(params.agent_id || _context?.sender_id || "agent");
    const payload = (params.payload && typeof params.payload === "object" && !Array.isArray(params.payload))
      ? { ...(params.payload as Record<string, unknown>) }
      : {};

    let event_result: AppendWorkflowEventResult | null = null;
    if (this.event_recorder) {
      try {
        event_result = await this.event_recorder({
          event_id,
          run_id,
          task_id,
          agent_id,
          phase,
          summary: content,
          payload,
          provider: channel,
          channel,
          chat_id,
          source: "outbound",
          detail: detail || null,
          at: now_iso(),
        });
      } catch (error) {
        return `Error: event_record_failed:${error_message(error)}`;
      }
    }

    const media_raw = Array.isArray(params.media) ? params.media : [];
    const media_items: MediaItem[] = [];
    const media_seen = new Set<string>();
    for (const row of media_raw) {
      const item = to_local_media_item(String(row || ""), this.workspace_dir);
      if (!item) continue;
      if (media_seen.has(item.url)) continue;
      media_seen.add(item.url);
      media_items.push(item);
    }
    const normalized_event = event_result?.event || {
      event_id,
      run_id,
      task_id,
      agent_id,
      phase,
      summary: content,
      payload,
      provider: channel,
      channel,
      chat_id,
      source: "outbound",
      at: now_iso(),
      detail_file: null,
    };

    const message: OutboundMessage = {
      id: short_id(),
      provider: channel,
      channel,
      sender_id: agent_id || "agent",
      chat_id,
      content,
      at: now_iso(),
      reply_to: params.reply_to ? String(params.reply_to) : (context.reply_to || undefined),
      media: media_items,
      metadata: {
        kind: "workflow_event",
        orchestrator_event: normalized_event,
      },
    };
    await this.send_callback(message);
    this.sent_in_turn = true;
    const detail_hint = normalized_event.detail_file ? ` detail_file=${normalized_event.detail_file}` : "";
    return `Event sent phase=${phase} task_id=${task_id} event_id=${normalized_event.event_id}${detail_hint}`;
  }
}

