import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { validate_file_path } from "../utils/path-validation.js";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso, error_message, short_id} from "../utils/common.js";
import { BaseChannel } from "./base.js";
import { channel_fetch, parse_json_response } from "./http-utils.js";
import type { DiscordChannelSettings } from "./settings.types.js";

type DiscordChannelOptions = {
  instance_id?: string;
  bot_token?: string;
  default_channel?: string;
  api_base?: string;
  workspace_dir?: string;
  settings?: DiscordChannelSettings;
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
    id: String(raw.id || short_id()),
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
  private readonly workspace_dir: string;
  private readonly settings: DiscordChannelSettings;

  constructor(options?: DiscordChannelOptions) {
    super("discord", options?.instance_id);
    this.bot_token = options?.bot_token || "";
    this.default_channel = options?.default_channel || "";
    this.api_base = options?.api_base || "https://discord.com/api/v10";
    this.workspace_dir = options?.workspace_dir || "";
    this.settings = options?.settings || {};
  }

  async start(): Promise<void> {
    if (!this.bot_token) throw new Error("discord_bot_token_missing");
    this.running = true;
    this.log.info("started", { instance_id: this.instance_id });
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
      const text = String(message.content || "");
      const chunk_size = Math.max(500, Number(this.settings.text_chunk_size || 1900));
      const file_fallback_threshold = Math.max(4_000, Number(this.settings.text_file_fallback_threshold || 8_000));
      let first_message_id = "";

      const base_payload: Record<string, unknown> = {};
      if (message.reply_to) {
        base_payload.message_reference = { message_id: message.reply_to };
        base_payload.allowed_mentions = { replied_user: false };
      }

      if (Array.isArray(message.media) && message.media.length > 0) {
        const payload = { ...base_payload, content: text.slice(0, 2000) };
        const form = new FormData();
        form.set("payload_json", JSON.stringify(payload));
        let i = 0;
        for (const media of message.media) {
          if (!media?.url) continue;
          const filePath = String(media.url);
          if (!validate_file_path(filePath, [tmpdir(), process.cwd(), ...(this.workspace_dir ? [this.workspace_dir] : [])])) continue;
          const bytes = await readFile(filePath);
          form.set(`files[${i}]`, new Blob([bytes]), media.name || basename(filePath));
          i += 1;
        }
        const response = await channel_fetch(`${this.api_base}/channels/${chat_id}/messages`, {
          method: "POST",
          headers: { Authorization: `Bot ${this.bot_token}` },
          body: form,
        });
        const data = await parse_json_response(response);
        if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
        first_message_id = String(data.id || "");
      } else if (text) {
        if (text.length >= file_fallback_threshold) {
          const notice = await this.post_text(chat_id, `본문이 길어 첨부 파일로 전송했습니다. (chars=${text.length})`, base_payload);
          if (!notice.ok) return notice;
          first_message_id = String(notice.message_id || "");
          const upload = await this.upload_text_file(chat_id, text, `long-message-${Date.now()}.txt`);
          if (!upload.ok) return upload;
        } else {
          const chunks = this.split_text_chunks(text, chunk_size);
          for (let idx = 0; idx < chunks.length; idx += 1) {
            const part = chunks.length > 1 ? `[${idx + 1}/${chunks.length}]\n${chunks[idx]}` : chunks[idx];
            const payload = idx === 0 ? { ...base_payload } : {};
            const posted = await this.post_text(chat_id, part, payload);
            if (!posted.ok) return posted;
            if (!first_message_id) first_message_id = String(posted.message_id || "");
          }
        }
      }
      return { ok: true, message_id: first_message_id || String(message.reply_to || "") };
    } catch (error) {
      const msg = error_message(error);
      this.log.warn("send failed", { chat_id, error: msg });
      return { ok: false, error: msg };
    } finally {
      await this.set_typing(chat_id, false);
    }
  }

  private async post_text(
    channel: string, text: string, extra_payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const payload = { ...extra_payload, content: String(text || "").slice(0, 2000) };
    const response = await channel_fetch(`${this.api_base}/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.bot_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parse_json_response(response);
    if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
    return { ok: true, message_id: String(data.id || "") };
  }

  private async upload_text_file(
    channel: string, text: string, filename: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ content: "" }));
    form.set("files[0]", new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
    const response = await channel_fetch(`${this.api_base}/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.bot_token}` },
      body: form,
    });
    const data = await parse_json_response(response);
    if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
    return { ok: true };
  }

  async read(chat_id: string, limit = 20): Promise<InboundMessage[]> {
    if (!this.bot_token) return [];
    const n = Math.max(1, Math.min(100, Number(limit || 20)));
    try {
      const response = await channel_fetch(`${this.api_base}/channels/${chat_id}/messages?limit=${n}`, {
        headers: { Authorization: `Bot ${this.bot_token}` },
      });
      if (!response.ok) return [];
      const rows = (await response.json().catch(() => [])) as unknown;
      if (!Array.isArray(rows)) return [];
      const messages = rows
        .map((r) => (r && typeof r === "object" ? to_inbound_message(this, r as Record<string, unknown>, chat_id) : null))
        .filter((r): r is InboundMessage => Boolean(r));
      return this.filter_seen(messages);
    } catch (error) {
      this.last_error = error_message(error);
      this.log.warn("read failed", { chat_id, error: this.last_error });
      return [];
    }
  }

  async edit_message(chat_id: string, message_id: string, content: string, _parse_mode?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "discord_bot_token_missing" };
    if (!chat_id || !message_id) return { ok: false, error: "chat_id_and_message_id_required" };
    try {
      const response = await channel_fetch(`${this.api_base}/channels/${chat_id}/messages/${message_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bot ${this.bot_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: String(content || "") }),
      });
      const data = await parse_json_response(response);
      if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error_message(error) };
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
      const response = await channel_fetch(
        `${this.api_base}/channels/${chat_id}/messages/${message_id}/reactions/${emoji}/@me`,
        { method, headers: { Authorization: `Bot ${this.bot_token}` } },
      );
      if (!response.ok && response.status !== 204) {
        const data = await parse_json_response(response);
        return { ok: false, error: String(data.message || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  async send_poll(poll: import("./types.js").SendPollRequest): Promise<import("./types.js").SendPollResult> {
    if (!this.bot_token) return { ok: false, error: "discord_bot_token_missing" };
    const chat_id = String(poll.chat_id || this.default_channel || "");
    if (!chat_id) return { ok: false, error: "chat_id_required" };
    if (!poll.options || poll.options.length < 1) return { ok: false, error: "at_least_1_option_required" };
    try {
      // Discord Poll API: poll 객체를 메시지에 첨부
      const payload: Record<string, unknown> = {
        poll: {
          question: { text: String(poll.question || "").slice(0, 300) },
          answers: poll.options.map((o) => ({
            poll_media: { text: String(o.text || "").slice(0, 55) },
          })),
          allow_multiselect: poll.allows_multiple_answers === true,
          ...(poll.open_period ? { duration: Math.min(168, Math.max(1, Math.ceil(poll.open_period / 3600))) } : {}),
        },
      };
      const response = await channel_fetch(`${this.api_base}/channels/${chat_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${this.bot_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parse_json_response(response);
      if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
      return { ok: true, message_id: String(data.id || "") };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  protected async set_typing_remote(chat_id: string, typing: boolean, _anchor_message_id?: string): Promise<void> {
    if (!typing) return;
    if (!this.bot_token) return;
    await channel_fetch(`${this.api_base}/channels/${chat_id}/typing`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.bot_token}` },
    }).catch(() => {/* typing 실패는 무시 */});
  }
}
