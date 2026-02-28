import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { BaseChannel } from "./base.js";

type SlackChannelOptions = {
  bot_token?: string;
  default_channel?: string;
};

type SlackApiResult = Record<string, unknown>;

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
  private readonly bot_token: string;
  private readonly default_channel: string;

  constructor(options?: SlackChannelOptions) {
    super("slack");
    this.bot_token = options?.bot_token || process.env.SLACK_BOT_TOKEN || "";
    this.default_channel = options?.default_channel || process.env.SLACK_DEFAULT_CHANNEL || "";
  }

  async start(): Promise<void> {
    if (!this.bot_token) throw new Error("slack_bot_token_missing");
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const channel = String(message.chat_id || this.default_channel || "");
    if (!channel) return { ok: false, error: "chat_id_required" };
    if (!this.bot_token) return { ok: false, error: "slack_bot_token_missing" };
    try {
      await this.set_typing(channel, true);
      const text = String(message.content || "");
      const thread_ts = String(message.reply_to || "").trim() || undefined;
      const chunk_size = Math.max(500, Number(process.env.SLACK_TEXT_CHUNK_SIZE || 3200));
      const file_fallback_threshold = Math.max(8_000, Number(process.env.SLACK_TEXT_FILE_FALLBACK_THRESHOLD || 14_000));
      let root_message_ts = "";

      if (text.trim()) {
        if (text.length >= file_fallback_threshold) {
          const notice = await this.post_text_message(
            channel,
            `본문이 길어 첨부 파일로 전송했습니다. (chars=${text.length})`,
            thread_ts,
          );
          if (!notice.ok) return notice;
          root_message_ts = String(notice.message_id || "");
          const upload = await this.upload_text_file(
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
            const posted = await this.post_text_message(
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
          const filePath = String(media.url);
          const bytes = await readFile(filePath);
          const form = new FormData();
          form.set("channels", channel);
          form.set("filename", media.name || basename(filePath));
          form.set("filetype", media.mime || "auto");
          form.set("file", new Blob([bytes]), media.name || basename(filePath));
          if (thread_ts || root_message_ts) form.set("thread_ts", thread_ts || root_message_ts);
          const upload = await fetch("https://slack.com/api/files.upload", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.bot_token}`,
            },
            body: form,
          });
          const data = (await upload.json().catch(() => ({}))) as Record<string, unknown>;
          if (!upload.ok || data.ok !== true) {
            return { ok: false, error: String(data.error || `http_${upload.status}`) };
          }
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
    if (!this.bot_token) return [];
    const n = Math.max(1, Math.min(200, Number(limit || 20)));
    try {
      const history = await this.call_slack_api("conversations.history", {
        channel: chat_id,
        limit: String(n),
      });
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
        .filter((m) => m && typeof m === "object")
        .map((m) => m as Record<string, unknown>)
        .filter((m) => Number(m.reply_count || 0) > 0 && typeof m.thread_ts === "string")
        .slice(0, 5);

      for (const parent of threadedParents) {
        const thread_ts = String(parent.thread_ts || "");
        if (!thread_ts) continue;
        const replies = await this.call_slack_api("conversations.replies", {
          channel: chat_id,
          ts: thread_ts,
          limit: "20",
        });
        if (!replies.ok || !Array.isArray(replies.messages)) continue;
        for (const r of replies.messages) {
          if (!r || typeof r !== "object") continue;
          const rec = r as Record<string, unknown>;
          const ts = String(rec.ts || "");
          if (!ts) continue;
          merged.set(ts, rec);
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
    if (!this.bot_token || !anchor_message_id) return;
    const reaction = "hourglass_flowing_sand";
    const method = typing ? "reactions.add" : "reactions.remove";
    try {
      await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bot_token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: chat_id, timestamp: anchor_message_id, name: reaction }),
      });
    } catch { /* best-effort */ }
  }

  async edit_message(chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "slack_bot_token_missing" };
    if (!chat_id || !message_id) return { ok: false, error: "chat_id_and_message_id_required" };
    try {
      const response = await fetch("https://slack.com/api/chat.update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bot_token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: chat_id, ts: message_id, text: String(content || "") }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: String(data.error || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async add_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.slack_reaction("reactions.add", chat_id, message_id, reaction, "already_reacted");
  }

  async remove_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.slack_reaction("reactions.remove", chat_id, message_id, reaction, "no_reaction");
  }

  private async slack_reaction(
    method: string, chat_id: string, message_id: string, reaction: string, ignore_error: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "slack_bot_token_missing" };
    if (!chat_id || !message_id || !reaction) return { ok: false, error: "chat_id_message_id_reaction_required" };
    try {
      const response = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bot_token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: chat_id, timestamp: message_id, name: reaction.replace(/:/g, "") }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        const error = String(data.error || `http_${response.status}`);
        if (error === ignore_error) return { ok: true };
        return { ok: false, error };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async call_slack_api(method: string, params: Record<string, string>): Promise<SlackApiResult> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.bot_token}`,
      },
    });
    const data = await response.json().catch(() => ({ ok: false, error: `json_parse_failed_${response.status}` })) as SlackApiResult;
    if (!response.ok) {
      return {
        ok: false,
        error: String(data.error || `http_${response.status}`),
      };
    }
    return data;
  }

  private async post_text_message(
    channel: string,
    text: string,
    thread_ts?: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const payload: Record<string, unknown> = {
      channel,
      text: String(text || ""),
    };
    if (thread_ts) payload.thread_ts = thread_ts;
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bot_token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.ok !== true) {
      return { ok: false, error: String(data.error || `http_${response.status}`) };
    }
    return { ok: true, message_id: String(data.ts || "") };
  }

  private async upload_text_file(
    channel: string,
    text: string,
    filename: string,
    thread_ts?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const form = new FormData();
    form.set("channels", channel);
    form.set("filename", filename);
    form.set("filetype", "text");
    form.set("file", new Blob([String(text || "")], { type: "text/plain;charset=utf-8" }), filename);
    if (thread_ts) form.set("thread_ts", thread_ts);
    const upload = await fetch("https://slack.com/api/files.upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bot_token}`,
      },
      body: form,
    });
    const data = (await upload.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upload.ok || data.ok !== true) {
      return { ok: false, error: String(data.error || `http_${upload.status}`) };
    }
    return { ok: true };
  }
}
