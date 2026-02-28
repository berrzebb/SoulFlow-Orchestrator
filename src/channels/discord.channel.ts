import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { BaseChannel } from "./base.js";

type DiscordChannelOptions = {
  bot_token?: string;
  default_channel?: string;
  api_base?: string;
};

function to_inbound_message(channel: DiscordChannel, raw: Record<string, unknown>, chat_id: string): InboundMessage {
  const author = (raw.author && typeof raw.author === "object") ? (raw.author as Record<string, unknown>) : {};
  const from_is_bot = author.bot === true;
  const content = String(raw.content || "");
  const command = channel.parse_command(content);
  const mentions = channel.parse_agent_mentions(content);
  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as Array<Record<string, unknown>>) : [];
  const media: MediaItem[] = attachments
    .map((a) => {
      const url = String(a.url || a.proxy_url || "").trim();
      if (!url) return null;
      const mime = String(a.content_type || "").trim();
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
        name: String(a.filename || "").trim() || undefined,
        size: Number(a.size || 0) || undefined,
      } as MediaItem;
    })
    .filter((v): v is MediaItem => Boolean(v));
  return {
    id: String(raw.id || randomUUID().slice(0, 12)),
    provider: "discord",
    channel: "discord",
    sender_id: String(author.id || "unknown"),
    chat_id,
    content,
    at: now_iso(),
    thread_id: typeof raw.channel_id === "string" ? raw.channel_id : undefined,
    media,
    metadata: { discord: raw, command, mentions, from_is_bot, message_id: String(raw.id || "") },
  };
}

export class DiscordChannel extends BaseChannel {
  private readonly bot_token: string;
  private readonly default_channel: string;
  private readonly api_base: string;

  constructor(options?: DiscordChannelOptions) {
    super("discord");
    this.bot_token = options?.bot_token || process.env.DISCORD_BOT_TOKEN || "";
    this.default_channel = options?.default_channel || process.env.DISCORD_DEFAULT_CHANNEL || "";
    this.api_base = options?.api_base || process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
  }

  async start(): Promise<void> {
    if (!this.bot_token) throw new Error("discord_bot_token_missing");
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const chat_id = String(message.chat_id || this.default_channel || "");
    if (!chat_id) return { ok: false, error: "chat_id_required" };
    if (!this.bot_token) return { ok: false, error: "discord_bot_token_missing" };
    try {
      await this.set_typing(chat_id, true);
      const payload: Record<string, unknown> = {
        content: String(message.content || ""),
      };
      if (message.reply_to) {
        payload.message_reference = { message_id: message.reply_to };
        payload.allowed_mentions = { replied_user: false };
      }
      let response: Response;
      if (Array.isArray(message.media) && message.media.length > 0) {
        const form = new FormData();
        form.set("payload_json", JSON.stringify(payload));
        let i = 0;
        for (const media of message.media) {
          if (!media?.url) continue;
          const filePath = String(media.url);
          const bytes = await readFile(filePath);
          form.set(`files[${i}]`, new Blob([bytes]), media.name || basename(filePath));
          i += 1;
        }
        response = await fetch(`${this.api_base}/channels/${chat_id}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.bot_token}`,
          },
          body: form,
        });
      } else {
        response = await fetch(`${this.api_base}/channels/${chat_id}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${this.bot_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      }
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
      return { ok: true, message_id: String(data.id || "") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      await this.set_typing(chat_id, false);
    }
  }

  async read(chat_id: string, limit = 20): Promise<InboundMessage[]> {
    if (!this.bot_token) return [];
    const n = Math.max(1, Math.min(100, Number(limit || 20)));
    try {
      const response = await fetch(`${this.api_base}/channels/${chat_id}/messages?limit=${n}`, {
        headers: {
          Authorization: `Bot ${this.bot_token}`,
        },
      });
      if (!response.ok) return [];
      const rows = (await response.json().catch(() => [])) as unknown;
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r) => (r && typeof r === "object" ? to_inbound_message(this, r as Record<string, unknown>, chat_id) : null))
        .filter((r): r is InboundMessage => Boolean(r));
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
      return [];
    }
  }

  async edit_message(chat_id: string, message_id: string, content: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "discord_bot_token_missing" };
    if (!chat_id || !message_id) return { ok: false, error: "chat_id_and_message_id_required" };
    try {
      const response = await fetch(`${this.api_base}/channels/${chat_id}/messages/${message_id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${this.bot_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: String(content || "") }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async add_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.discord_reaction("PUT", chat_id, message_id, reaction);
  }

  async remove_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    return this.discord_reaction("DELETE", chat_id, message_id, reaction);
  }

  private async discord_reaction(
    method: string, chat_id: string, message_id: string, reaction: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "discord_bot_token_missing" };
    if (!chat_id || !message_id || !reaction) return { ok: false, error: "chat_id_message_id_reaction_required" };
    try {
      const emoji = encodeURIComponent(reaction.replace(/:/g, ""));
      const response = await fetch(
        `${this.api_base}/channels/${chat_id}/messages/${message_id}/reactions/${emoji}/@me`,
        { method, headers: { Authorization: `Bot ${this.bot_token}` } },
      );
      if (!response.ok && response.status !== 204) {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: false, error: String(data.message || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected async set_typing_remote(chat_id: string, typing: boolean, _anchor_message_id?: string): Promise<void> {
    if (!typing) return;
    if (!this.bot_token) return;
    await fetch(`${this.api_base}/channels/${chat_id}/typing`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.bot_token}`,
      },
    });
  }
}
