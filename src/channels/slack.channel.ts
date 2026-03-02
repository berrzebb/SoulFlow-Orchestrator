import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { WebClient } from "@slack/web-api";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { BaseChannel } from "./base.js";

type SlackChannelOptions = {
  bot_token?: string;
  default_channel?: string;
};

function to_inbound_message(channel: SlackChannel, raw: Record<string, unknown>, chat_id: string): InboundMessage {
  const content = String((raw.text as string) || "");
  const command = channel.parse_command(content);
  const mentions = channel.parse_agent_mentions(content);
  const subtype = String(raw.subtype || "").toLowerCase();
  const from_is_bot = (typeof raw.bot_id === "string" && String(raw.bot_id).trim().length > 0)
    || subtype === "bot_message";
  const sender_id = String((raw.user as string) || (raw.username as string) || (raw.bot_id as string) || "unknown");
  const files_raw = Array.isArray(raw.files) ? (raw.files as Array<Record<string, unknown>>) : [];
  const media: MediaItem[] = files_raw
    .map((f) => {
      const url = String(f.url_private_download || f.url_private || "");
      if (!url) return null;
      const mime = String(f.mimetype || "");
      const type: MediaItem["type"] = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : mime.startsWith("audio/")
            ? "audio"
            : "file";
      return {
        type,
        url,
        mime: mime || undefined,
        name: String(f.name || "") || undefined,
        size: Number(f.size || 0) || undefined,
      } as MediaItem;
    })
    .filter((m): m is MediaItem => Boolean(m));
  return {
    id: String(raw.ts || randomUUID().slice(0, 12)),
    provider: "slack",
    channel: "slack",
    sender_id,
    chat_id,
    content,
    at: now_iso(),
    thread_id: typeof raw.thread_ts === "string" ? raw.thread_ts : undefined,
    media,
    metadata: { slack: raw, command, mentions, from_is_bot, message_id: String(raw.ts || "") },
  };
}

export class SlackChannel extends BaseChannel {
  private readonly client: WebClient;
  private readonly default_channel: string;

  constructor(options?: SlackChannelOptions) {
    super("slack");
    const token = options?.bot_token || process.env.SLACK_BOT_TOKEN || "";
    this.client = new WebClient(token);
    this.default_channel = options?.default_channel || process.env.SLACK_DEFAULT_CHANNEL || "";
  }

  async start(): Promise<void> {
    await this.client.auth.test();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const channel = String(message.chat_id || this.default_channel || "");
    if (!channel) return { ok: false, error: "chat_id_required" };
    try {
      await this.set_typing(channel, true);
      const text = String(message.content || "");
      const thread_ts = String(message.reply_to || "").trim() || undefined;
      const chunk_size = Math.max(500, Number(process.env.SLACK_TEXT_CHUNK_SIZE || 3200));
      const file_fallback_threshold = Math.max(8_000, Number(process.env.SLACK_TEXT_FILE_FALLBACK_THRESHOLD || 14_000));
      let root_message_ts = "";

      if (text.trim()) {
        if (text.length >= file_fallback_threshold) {
          const notice = await this.post_text(
            channel,
            `본문이 길어 첨부 파일로 전송했습니다. (chars=${text.length})`,
            thread_ts,
          );
          if (!notice.ok) return notice;
          root_message_ts = String(notice.message_id || "");
          const upload = await this.upload_content(
            channel,
            text,
            `long-message-${Date.now()}.txt`,
            thread_ts || root_message_ts || undefined,
          );
          if (!upload.ok) return upload;
        } else {
          const chunks = this.split_text_chunks(text, chunk_size);
          for (let idx = 0; idx < chunks.length; idx += 1) {
            const part = chunks[idx];
            const prefix = chunks.length > 1 ? `[${idx + 1}/${chunks.length}]\n` : "";
            const posted = await this.post_text(
              channel,
              `${prefix}${part}`,
              thread_ts || root_message_ts || undefined,
            );
            if (!posted.ok) return posted;
            if (!root_message_ts) root_message_ts = String(posted.message_id || "");
          }
        }
      }

      if (Array.isArray(message.media) && message.media.length > 0) {
        for (const media of message.media) {
          if (!media?.url) continue;
          const bytes = await readFile(String(media.url));
          const filename = media.name || basename(String(media.url));
          const upload = await this.upload_binary(channel, bytes, filename, thread_ts || root_message_ts || undefined);
          if (!upload.ok) return upload;
        }
      }
      return { ok: true, message_id: root_message_ts || String(message.reply_to || "") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await this.set_typing(channel, false);
    }
  }

  async read(chat_id: string, limit = 20): Promise<InboundMessage[]> {
    const n = Math.max(1, Math.min(200, Number(limit || 20)));
    try {
      const history = await this.client.conversations.history({ channel: chat_id, limit: n });
      if (!history.ok) {
        this.last_error = String(history.error || "conversations_history_failed");
        return [];
      }
      const messages = Array.isArray(history.messages) ? history.messages : [];
      const merged = new Map<string, Record<string, unknown>>();
      for (const row of messages) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const ts = String(rec.ts || "");
        if (!ts) continue;
        merged.set(ts, rec);
      }

      const threadedParents = messages
        .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
        .filter((m) => Number(m.reply_count || 0) > 0 && typeof m.thread_ts === "string")
        .slice(0, 5);

      for (const parent of threadedParents) {
        const ts = String(parent.thread_ts || "");
        if (!ts) continue;
        const replies = await this.client.conversations.replies({ channel: chat_id, ts, limit: 20 });
        if (!replies.ok || !Array.isArray(replies.messages)) continue;
        for (const r of replies.messages) {
          if (!r || typeof r !== "object") continue;
          const rec = r as Record<string, unknown>;
          const rts = String(rec.ts || "");
          if (!rts) continue;
          merged.set(rts, rec);
        }
      }

      const rows = [...merged.values()]
        .sort((a, b) => Number(String(a.ts || "0")) - Number(String(b.ts || "0")));

      return rows
        .map((m) => to_inbound_message(this, m, chat_id))
        .filter((m): m is InboundMessage => Boolean(m));
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  protected async set_typing_remote(chat_id: string, typing: boolean, anchor_message_id?: string): Promise<void> {
    if (!anchor_message_id) return;
    const name = "hourglass_flowing_sand";
    try {
      if (typing) {
        await this.client.reactions.add({ channel: chat_id, timestamp: anchor_message_id, name });
      } else {
        await this.client.reactions.remove({ channel: chat_id, timestamp: anchor_message_id, name });
      }
    } catch { /* best-effort */ }
  }

  async edit_message(chat_id: string, message_id: string, content: string, _parse_mode?: string): Promise<{ ok: boolean; error?: string }> {
    if (!chat_id || !message_id) return { ok: false, error: "chat_id_and_message_id_required" };
    try {
      await this.client.chat.update({ channel: chat_id, ts: message_id, text: String(content || "") });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async add_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.toggle_reaction("add", chat_id, message_id, reaction, "already_reacted");
  }

  async remove_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.toggle_reaction("remove", chat_id, message_id, reaction, "no_reaction");
  }

  private async toggle_reaction(
    action: "add" | "remove", chat_id: string, message_id: string, reaction: string, ignore_error: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!chat_id || !message_id || !reaction) return { ok: false, error: "chat_id_message_id_reaction_required" };
    try {
      const name = reaction.replace(/:/g, "");
      if (action === "add") {
        await this.client.reactions.add({ channel: chat_id, timestamp: message_id, name });
      } else {
        await this.client.reactions.remove({ channel: chat_id, timestamp: message_id, name });
      }
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes(ignore_error)) return { ok: true };
      return { ok: false, error: msg };
    }
  }

  private async post_text(
    channel: string, text: string, thread_ts?: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    try {
      const result = await this.client.chat.postMessage({
        channel,
        text: String(text || ""),
        thread_ts,
        mrkdwn: true,
      });
      return { ok: true, message_id: String(result.ts || "") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async upload_content(
    channel: string, text: string, filename: string, thread_ts?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { channel_id: channel, content: String(text || ""), filename, title: filename };
      if (thread_ts) args.thread_ts = thread_ts;
      await (this.client.filesUploadV2 as (a: unknown) => Promise<unknown>)(args);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async upload_binary(
    channel: string, file: Buffer, filename: string, thread_ts?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const args: Record<string, unknown> = { channel_id: channel, file, filename, title: filename };
      if (thread_ts) args.thread_ts = thread_ts;
      await (this.client.filesUploadV2 as (a: unknown) => Promise<unknown>)(args);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
