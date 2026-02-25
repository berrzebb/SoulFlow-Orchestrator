import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { BaseChannel } from "./base.js";

type TelegramChannelOptions = {
  bot_token?: string;
  default_chat_id?: string;
  api_base?: string;
};

function as_string(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function to_inbound_message(
  channel: TelegramChannel,
  raw: Record<string, unknown>,
  chat_id: string,
  update_id: number,
): InboundMessage {
  const from = (raw.from && typeof raw.from === "object") ? (raw.from as Record<string, unknown>) : {};
  const from_is_bot = from.is_bot === true;
  const content = as_string(raw.text || raw.caption || "");
  const command = channel.parse_command(content);
  const mentions = channel.parse_agent_mentions(content);
  const media: MediaItem[] = [];
  const doc = (raw.document && typeof raw.document === "object") ? (raw.document as Record<string, unknown>) : null;
  const video = (raw.video && typeof raw.video === "object") ? (raw.video as Record<string, unknown>) : null;
  const audio = (raw.audio && typeof raw.audio === "object") ? (raw.audio as Record<string, unknown>) : null;
  const photos = Array.isArray(raw.photo) ? (raw.photo as Array<Record<string, unknown>>) : [];
  if (doc?.file_id) {
    media.push({
      type: "file",
      url: `tg://file_id/${String(doc.file_id)}`,
      mime: String(doc.mime_type || "") || undefined,
      name: String(doc.file_name || "") || undefined,
      size: Number(doc.file_size || 0) || undefined,
    });
  }
  if (video?.file_id) {
    media.push({
      type: "video",
      url: `tg://file_id/${String(video.file_id)}`,
      mime: String(video.mime_type || "") || undefined,
      name: String(video.file_name || "") || undefined,
      size: Number(video.file_size || 0) || undefined,
    });
  }
  if (audio?.file_id) {
    media.push({
      type: "audio",
      url: `tg://file_id/${String(audio.file_id)}`,
      mime: String(audio.mime_type || "") || undefined,
      name: String(audio.file_name || "") || undefined,
      size: Number(audio.file_size || 0) || undefined,
    });
  }
  if (photos.length > 0) {
    const p = photos[photos.length - 1];
    if (p?.file_id) {
      media.push({
        type: "image",
        url: `tg://file_id/${String(p.file_id)}`,
        size: Number(p.file_size || 0) || undefined,
      });
    }
  }
  const dedupe_id = Number.isFinite(update_id) && update_id > 0
    ? String(update_id)
    : as_string(raw.message_id || randomUUID().slice(0, 12));
  return {
    id: dedupe_id,
    provider: "telegram",
    channel: "telegram",
    sender_id: as_string(from.id || "unknown"),
    chat_id,
    content,
    at: now_iso(),
    media,
    metadata: {
      telegram: raw,
      command,
      mentions,
      from_is_bot,
      message_id: dedupe_id,
      telegram_message_id: as_string(raw.message_id || ""),
    },
  };
}

export class TelegramChannel extends BaseChannel {
  private readonly bot_token: string;
  private readonly default_chat_id: string;
  private readonly api_base: string;
  private last_update_id = 0;

  constructor(options?: TelegramChannelOptions) {
    super("telegram");
    this.bot_token = options?.bot_token || process.env.TELEGRAM_BOT_TOKEN || "";
    this.default_chat_id = options?.default_chat_id || process.env.TELEGRAM_DEFAULT_CHAT_ID || "";
    this.api_base = options?.api_base || process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
  }

  async start(): Promise<void> {
    if (!this.bot_token) throw new Error("telegram_bot_token_missing");
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const chat_id = as_string(message.chat_id || this.default_chat_id || "");
    if (!chat_id) return { ok: false, error: "chat_id_required" };
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    try {
      await this.set_typing(chat_id, true);
      const text = as_string(message.content || "");
      const meta = (message.metadata && typeof message.metadata === "object")
        ? (message.metadata as Record<string, unknown>)
        : {};
      const parse_mode = this.resolve_parse_mode(meta.render_parse_mode || meta.parse_mode);
      const chunk_size = Math.max(500, Number(process.env.TELEGRAM_TEXT_CHUNK_SIZE || 3500));
      const file_fallback_threshold = Math.max(8_000, Number(process.env.TELEGRAM_TEXT_FILE_FALLBACK_THRESHOLD || 14_000));
      let first_message_id = "";
      if (Array.isArray(message.media) && message.media.length > 0) {
        for (let idx = 0; idx < message.media.length; idx += 1) {
          const media = message.media[idx];
          const filePath = String(media?.url || "");
          if (!filePath) continue;
          const bytes = await readFile(filePath);
          const extension = extname(filePath).toLowerCase();
          const isPhoto = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension);
          const method = isPhoto ? "sendPhoto" : "sendDocument";
          const url = `${this.api_base}/bot${this.bot_token}/${method}`;
          const form = new FormData();
          form.set("chat_id", chat_id);
          form.set(isPhoto ? "photo" : "document", new Blob([bytes]), media.name || basename(filePath));
          if (idx === 0 && text) form.set("caption", as_string(text).slice(0, 900));
          if (idx === 0 && parse_mode && text) form.set("parse_mode", parse_mode);
          if (idx === 0 && message.reply_to) form.set("reply_to_message_id", as_string(message.reply_to));
          const response = await fetch(url, {
            method: "POST",
            body: form,
          });
          const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok || data.ok !== true) {
            return { ok: false, error: as_string(data.description || `http_${response.status}`) };
          }
          const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
          if (!first_message_id) first_message_id = as_string(result.message_id || "");
        }
      } else if (text) {
        if (parse_mode) {
          if (text.length > chunk_size || text.length >= file_fallback_threshold) {
            const doc = await this.send_text_document(
              chat_id,
              text,
              `long-message-${Date.now()}.txt`,
              as_string(message.reply_to || ""),
            );
            if (!doc.ok) return doc;
            first_message_id = as_string(doc.message_id || "");
            return { ok: true, message_id: first_message_id || as_string(message.reply_to || "") };
          }
          const url = `${this.api_base}/bot${this.bot_token}/sendMessage`;
          const payload: Record<string, unknown> = {
            chat_id,
            text,
            parse_mode,
          };
          if (message.reply_to) payload.reply_to_message_id = message.reply_to;
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok || data.ok !== true) {
            return { ok: false, error: as_string(data.description || `http_${response.status}`) };
          }
          const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
          first_message_id = as_string(result.message_id || "");
          return { ok: true, message_id: first_message_id || as_string(message.reply_to || "") };
        }
        if (text.length >= file_fallback_threshold) {
          const doc = await this.send_text_document(
            chat_id,
            text,
            `long-message-${Date.now()}.txt`,
            as_string(message.reply_to || ""),
          );
          if (!doc.ok) return doc;
          first_message_id = as_string(doc.message_id || "");
        } else {
          const chunks = this.split_text_chunks(text, chunk_size);
          for (let idx = 0; idx < chunks.length; idx += 1) {
            const url = `${this.api_base}/bot${this.bot_token}/sendMessage`;
            const payload: Record<string, unknown> = {
              chat_id,
              text: chunks.length > 1 ? `[${idx + 1}/${chunks.length}]\n${chunks[idx]}` : chunks[idx],
            };
            if (idx === 0 && message.reply_to) payload.reply_to_message_id = message.reply_to;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
            if (!response.ok || data.ok !== true) {
              return { ok: false, error: as_string(data.description || `http_${response.status}`) };
            }
            const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
            if (!first_message_id) first_message_id = as_string(result.message_id || "");
          }
        }
      }
      return { ok: true, message_id: first_message_id || as_string(message.reply_to || "") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await this.set_typing(chat_id, false);
    }
  }

  private resolve_parse_mode(value: unknown): "HTML" | null {
    const mode = String(value || "").trim().toUpperCase();
    if (mode === "HTML") return "HTML";
    return null;
  }

  async read(chat_id: string, limit = 20): Promise<InboundMessage[]> {
    if (!this.bot_token) return [];
    const n = Math.max(1, Math.min(100, Number(limit || 20)));
    try {
      const offset_qs = this.last_update_id > 0 ? `&offset=${this.last_update_id + 1}` : "";
      const url = `${this.api_base}/bot${this.bot_token}/getUpdates?limit=${n}&timeout=0${offset_qs}`;
      const response = await fetch(url);
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        this.last_error = as_string(data.description || `http_${response.status}`);
        return [];
      }
      const results = Array.isArray(data.result) ? data.result : [];
      const rows: InboundMessage[] = [];
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const update = item as Record<string, unknown>;
        const update_id = Number(update.update_id || 0);
        if (Number.isFinite(update_id) && update_id > this.last_update_id) {
          this.last_update_id = update_id;
        }
        const msg = (update.message && typeof update.message === "object")
          ? (update.message as Record<string, unknown>)
          : null;
        if (!msg) continue;
        const msg_chat = (msg.chat && typeof msg.chat === "object") ? (msg.chat as Record<string, unknown>) : {};
        if (as_string(msg_chat.id) !== as_string(chat_id)) continue;
        rows.push(to_inbound_message(this, msg, chat_id, update_id));
      }
      return rows;
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  protected async set_typing_remote(chat_id: string, typing: boolean): Promise<void> {
    if (!typing) return;
    if (!this.bot_token) return;
    const url = `${this.api_base}/bot${this.bot_token}/sendChatAction`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        action: "typing",
      }),
    });
  }

  private split_text_chunks(raw: string, max_chars: number): string[] {
    const text = String(raw || "");
    const max = Math.max(500, Number(max_chars || 3500));
    if (text.length <= max) return [text];
    const out: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      const remain = text.length - cursor;
      if (remain <= max) {
        out.push(text.slice(cursor));
        break;
      }
      const probe = text.slice(cursor, cursor + max);
      const hard_break = Math.max(probe.lastIndexOf("\n\n"), probe.lastIndexOf("\n"), probe.lastIndexOf(" "));
      const take = hard_break > Math.floor(max * 0.55) ? hard_break : max;
      out.push(text.slice(cursor, cursor + take).trim());
      cursor += take;
    }
    return out.filter((v) => Boolean(String(v || "").trim()));
  }

  private async send_text_document(
    chat_id: string,
    text: string,
    filename: string,
    reply_to_message_id?: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const url = `${this.api_base}/bot${this.bot_token}/sendDocument`;
    const form = new FormData();
    form.set("chat_id", chat_id);
    if (reply_to_message_id) form.set("reply_to_message_id", reply_to_message_id);
    form.set("caption", `본문이 길어 파일로 전송했습니다. (chars=${text.length})`);
    form.set(
      "document",
      new Blob([String(text || "")], { type: "text/plain;charset=utf-8" }),
      filename,
    );
    const response = await fetch(url, {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || data.ok !== true) {
      return { ok: false, error: as_string(data.description || `http_${response.status}`) };
    }
    const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
    return { ok: true, message_id: as_string(result.message_id || "") };
  }
}
