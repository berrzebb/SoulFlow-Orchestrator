import { randomUUID } from "node:crypto";
import { Tool } from "./base.js";
import type { OutboundMessage } from "../../bus/types.js";
import { now_iso } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import type { AppendWorkflowEventInput, AppendWorkflowEventResult, WorkflowPhase } from "../../events/types.js";

export type MessageSendCallback = (message: OutboundMessage) => Promise<void>;
export type MessageEventRecordCallback = (event: AppendWorkflowEventInput) => Promise<AppendWorkflowEventResult>;

const PHASE_SET = new Set<WorkflowPhase>(["assign", "progress", "blocked", "done", "approval"]);

function normalize_text(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize_phase(value: unknown): WorkflowPhase {
  const v = String(value || "").trim().toLowerCase();
  if (PHASE_SET.has(v as WorkflowPhase)) return v as WorkflowPhase;
  return "progress";
}

export class MessageTool extends Tool {
  readonly name = "message";
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
      task_id: { type: "string", description: "Task id (used for fixed detail file name)" },
      run_id: { type: "string", description: "Run id for correlated events" },
      event_id: { type: "string", description: "Idempotent event id (optional)" },
      agent_id: { type: "string", description: "Agent id/alias for the event producer" },
      detail: { type: "string", description: "Detailed body to append to task detail file (<task_id>.md)" },
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
  private default_channel: string;
  private default_chat_id: string;
  private default_reply_to: string | null;
  private sent_in_turn = false;

  constructor(args?: {
    send_callback?: MessageSendCallback | null;
    event_recorder?: MessageEventRecordCallback | null;
    default_channel?: string;
    default_chat_id?: string;
    default_reply_to?: string | null;
  }) {
    super();
    this.send_callback = args?.send_callback || null;
    this.event_recorder = args?.event_recorder || null;
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
    const channel = String(params.channel || this.default_channel || "");
    const chat_id = String(params.chat_id || this.default_chat_id || "");
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
    const event_id = normalize_text(params.event_id || randomUUID().slice(0, 12));
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
        return `Error: event_record_failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const media_raw = Array.isArray(params.media) ? params.media : [];
    const media_urls = media_raw.map((m) => String(m)).filter(Boolean);
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
      id: randomUUID().slice(0, 12),
      provider: channel,
      channel,
      sender_id: agent_id || "agent",
      chat_id,
      content,
      at: now_iso(),
      reply_to: params.reply_to ? String(params.reply_to) : this.default_reply_to || undefined,
      media: media_urls.map((url) => ({ type: "link", url })),
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

