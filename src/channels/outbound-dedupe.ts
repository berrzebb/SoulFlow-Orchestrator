import type { OutboundMessage } from "../bus/types.js";
import { normalize_text as _normalize_text } from "../utils/common.js";
import type { ChannelProvider } from "./types.js";

export interface OutboundDedupePolicy {
  key(provider: ChannelProvider, message: OutboundMessage): string;
}

const normalize_text = (v: unknown): string => _normalize_text(v, true);

function normalize_media(message: OutboundMessage): string {
  return Array.isArray(message.media)
    ? message.media
      .map((row) => `${String(row?.type || "")}:${normalize_text(row?.url || "")}`)
      .filter(Boolean)
      .sort()
      .join("|")
    : "";
}

export class DefaultOutboundDedupePolicy implements OutboundDedupePolicy {
  key(provider: ChannelProvider, message: OutboundMessage): string {
    const metadata = (message.metadata && typeof message.metadata === "object")
      ? (message.metadata as Record<string, unknown>)
      : {};
    const kind = normalize_text(metadata.kind || "");
    const trigger = normalize_text(
      metadata.trigger_message_id
      || metadata.source_message_id
      || metadata.request_id
      || "",
    );
    const sender = normalize_text(message.sender_id || "");
    const chat = normalize_text(message.chat_id || "");
    const reply_to = normalize_text(message.reply_to || "");
    const thread = normalize_text(message.thread_id || "");
    const instance = normalize_text(message.instance_id || provider);

    // Agent final/error replies should be emitted once per source message.
    if ((kind === "agent_reply" || kind === "agent_error") && trigger) {
      return [instance, chat, thread, reply_to, kind, trigger].join("::");
    }

    const text = normalize_text(message.content || "");
    const media = normalize_media(message);
    const base = trigger || sender;
    return [instance, chat, thread, reply_to, kind, base, text, media].join("::");
  }
}
