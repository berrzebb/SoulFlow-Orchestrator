import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import { BaseChannel } from "./base.js";

type DiscordChannelOptions = {
  bot_token?: string;
  default_channel?: string;
  api_base?: string;
};

function to_inbound_message(channel: DiscordChannel, raw: Record<string, unknown>, chat_id: string): InboundMessage {
  const author = (raw.author && typeof raw.author === "object") ? (raw.author as Record<string, unknown>) : {};
  const content = String(raw.content || "");
  const command = channel.parse_command(content);
  const mentions = channel.parse_agent_mentions(content);
  return {
    id: String(raw.id || randomUUID().slice(0, 12)),
    provider: "discord",
    channel: "discord",
    sender_id: String(author.id || "unknown"),
    chat_id,
    content,
    at: now_iso(),
    thread_id: typeof raw.channel_id === "string" ? raw.channel_id : undefined,
    metadata: { discord: raw, command, mentions, message_id: String(raw.id || "") },
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
  }

  protected async set_typing_remote(chat_id: string, typing: boolean): Promise<void> {
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
