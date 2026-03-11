import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { validate_file_path } from "../utils/path-validation.js";
import type { InboundMessage, MediaItem, OutboundMessage } from "../bus/types.js";
import { now_iso, error_message, short_id} from "../utils/common.js";
import { BaseChannel } from "./base.js";
import { channel_fetch, parse_json_response } from "./http-utils.js";
import type { CommandDescriptor } from "./commands/registry.js";

type TelegramChannelOptions = {
  instance_id?: string;
  bot_token?: string;
  default_chat_id?: string;
  api_base?: string;
  settings?: Record<string, unknown>;
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
    : as_string(raw.message_id || short_id());
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

/**
 * 같은 media_group_id를 가진 메시지들의 미디어를 첫 번째 메시지로 병합.
 * Telegram은 멀티 포토/비디오를 별도 update로 보내지만, 사용자에게는 하나의 메시지.
 */
function coalesce_media_groups(rows: InboundMessage[]): InboundMessage[] {
  const groups = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const tg = rows[i].metadata?.telegram as Record<string, unknown> | undefined;
    const gid = as_string(tg?.media_group_id || "");
    if (!gid) continue;
    if (!groups.has(gid)) {
      groups.set(gid, i);
    } else {
      const first_idx = groups.get(gid)!;
      const first = rows[first_idx];
      if (rows[i].media) first.media = [...(first.media || []), ...rows[i].media!];
      if (!first.content && rows[i].content) first.content = rows[i].content;
      rows[i] = null as unknown as InboundMessage; // 병합됨 — 필터링 대상
    }
  }
  return groups.size > 0 ? rows.filter(Boolean) : rows;
}

/** Telegram message_reaction 업데이트를 InboundMessage로 변환. */
function to_reaction_message(
  raw: Record<string, unknown>,
  target_chat_id: string,
  update_id: number,
): InboundMessage | null {
  const chat = (raw.chat && typeof raw.chat === "object") ? (raw.chat as Record<string, unknown>) : {};
  if (as_string(chat.id) !== as_string(target_chat_id)) return null;
  const user = (raw.user && typeof raw.user === "object") ? (raw.user as Record<string, unknown>) : {};
  const new_reactions = Array.isArray(raw.new_reaction) ? (raw.new_reaction as Array<Record<string, unknown>>) : [];
  const emoji_list = new_reactions
    .filter((r) => String(r.type || "") === "emoji")
    .map((r) => String(r.emoji || ""))
    .filter(Boolean);
  if (emoji_list.length === 0) return null;
  return {
    id: String(update_id),
    provider: "telegram",
    channel: "telegram",
    sender_id: as_string(user.id || "unknown"),
    chat_id: target_chat_id,
    content: "",
    at: now_iso(),
    metadata: {
      is_reaction: true,
      telegram_reaction: {
        message_id: as_string(raw.message_id || ""),
        emoji: emoji_list,
      },
    },
  };
}


export class TelegramChannel extends BaseChannel {
  private readonly bot_token: string;
  private readonly default_chat_id: string;
  private readonly api_base: string;
  private readonly settings: Record<string, unknown>;
  private last_update_id = 0;
  /** 연속 read 실패 횟수 — 로그 빈도 조절용. */
  private consecutive_read_errors = 0;

  constructor(options?: TelegramChannelOptions) {
    super("telegram", options?.instance_id);
    this.bot_token = options?.bot_token || "";
    this.default_chat_id = options?.default_chat_id || "";
    this.settings = options?.settings || {};
    this.api_base = options?.api_base || "https://api.telegram.org";
  }

  async start(): Promise<void> {
    if (!this.bot_token) throw new Error("telegram_bot_token_missing");
    this.running = true;
    this.log.info("started", { instance_id: this.instance_id });
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
      // render_parse_mode: rendering.ts 파이프라인 경유 → escape 완료
      // parse_mode: 직접 설정 경로 → 사용자 입력 포함 가능하므로 escape 필요
      const from_renderer = this.resolve_parse_mode(meta.render_parse_mode);
      const from_direct = this.resolve_parse_mode(meta.parse_mode);
      const parse_mode = from_renderer || from_direct;
      const safe_text = (!from_renderer && from_direct === "HTML") ? this.escape_telegram_html(text) : text;
      const chunk_size = Math.max(500, Number(this.settings.text_chunk_size || 3500));
      const file_fallback_threshold = Math.max(8_000, Number(this.settings.text_file_fallback_threshold || 14_000));
      let first_message_id = "";
      if (Array.isArray(message.media) && message.media.length > 0) {
        for (let idx = 0; idx < message.media.length; idx += 1) {
          const media = message.media[idx];
          const filePath = String(media?.url || "");
          if (!filePath) continue;
          if (!validate_file_path(filePath, [tmpdir(), process.cwd()])) continue;
          const bytes = await readFile(filePath);
          const extension = extname(filePath).toLowerCase();
          const isPhoto = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension);
          const method = isPhoto ? "sendPhoto" : "sendDocument";
          const url = `${this.api_base}/bot${this.bot_token}/${method}`;
          const form = new FormData();
          form.set("chat_id", chat_id);
          form.set(isPhoto ? "photo" : "document", new Blob([bytes]), media.name || basename(filePath));
          if (idx === 0 && safe_text) form.set("caption", safe_text.slice(0, 900));
          if (idx === 0 && parse_mode && safe_text) form.set("parse_mode", parse_mode);
          if (idx === 0 && message.reply_to) form.set("reply_to_message_id", as_string(message.reply_to));
          const response = await channel_fetch(url, { method: "POST", body: form });
          const data = await parse_json_response(response);
          if (!response.ok || data.ok !== true) {
            return { ok: false, error: as_string(data.description || `http_${response.status}`) };
          }
          const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
          if (!first_message_id) first_message_id = as_string(result.message_id || "");
        }
      } else if (text) {
        if (parse_mode) {
          if (safe_text.length > chunk_size || safe_text.length >= file_fallback_threshold) {
            const doc = await this.send_text_document(
              chat_id,
              safe_text,
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
            text: safe_text,
            parse_mode,
          };
          if (message.reply_to) payload.reply_to_message_id = message.reply_to;
          const response = await channel_fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await parse_json_response(response);
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
            const response = await channel_fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await parse_json_response(response);
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
      const msg = error_message(error);
      this.log.warn("send failed", { chat_id, error: msg });
      return { ok: false, error: msg };
    } finally {
      await this.set_typing(chat_id, false);
    }
  }

  private resolve_parse_mode(value: unknown): "HTML" | null {
    const mode = String(value || "").trim().toUpperCase();
    if (mode === "HTML") return "HTML";
    return null;
  }

  /** HTML 특수문자 이스케이프 — parse_mode=HTML 직접 설정 경로에서 사용자 입력 보호. */
  private escape_telegram_html(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async read(chat_id: string, limit = 20): Promise<InboundMessage[]> {
    if (!this.bot_token || !this.running) return [];
    const n = Math.max(1, Math.min(100, Number(limit || 20)));
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
      try {
        const offset_qs = this.last_update_id > 0 ? `&offset=${this.last_update_id + 1}` : "";
        const allowed = encodeURIComponent(JSON.stringify(["message", "message_reaction"]));
        const url = `${this.api_base}/bot${this.bot_token}/getUpdates?limit=${n}&timeout=0&allowed_updates=${allowed}${offset_qs}`;
        const response = await channel_fetch(url);
        const data = await parse_json_response(response);
        if (!response.ok || data.ok !== true) {
          const desc = as_string(data.description || `http_${response.status}`);
          this.last_error = desc;
          if (/conflict.*terminated.*other.*getUpdates/i.test(desc)) {
            this.log.error("telegram conflict: another bot instance is polling — disabling reads to prevent duplicate processing", { description: desc });
            this.running = false;
          }
          return [];
        }
        this.consecutive_read_errors = 0;
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
          if (msg) {
            const msg_chat = (msg.chat && typeof msg.chat === "object") ? (msg.chat as Record<string, unknown>) : {};
            if (as_string(msg_chat.id) === as_string(chat_id)) {
              rows.push(to_inbound_message(this, msg, chat_id, update_id));
            }
            continue;
          }
          const rxn = (update.message_reaction && typeof update.message_reaction === "object")
            ? (update.message_reaction as Record<string, unknown>)
            : null;
          if (rxn) {
            const inbound = to_reaction_message(rxn, chat_id, update_id);
            if (inbound) rows.push(inbound);
          }
        }
        return this.filter_seen(coalesce_media_groups(rows));
      } catch (error) {
        if (attempt < MAX_RETRIES) continue;
        // 모든 재시도 소진 후 기록
        this.last_error = error_message(error);
        this.consecutive_read_errors++;
        // 첫 실패 또는 20번마다 로그 (장애 지속 중 폭발 방지)
        if (this.consecutive_read_errors === 1 || this.consecutive_read_errors % 20 === 0) {
          this.log.warn("read failed", { chat_id, error: this.last_error, consecutive: this.consecutive_read_errors });
        }
        return [];
      }
    }
    return [];
  }

  /** Telegram Bot API 9.3 sendMessageDraft: 스트리밍 드래프트 메시지 생성/갱신. */
  async send_draft(chat_id: string, text: string, reply_to_message_id?: string, draft_message_id?: string): Promise<{ ok: boolean; draft_id?: string; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    const url = `${this.api_base}/bot${this.bot_token}/sendMessageDraft`;
    const payload: Record<string, unknown> = { chat_id, text: String(text || "").slice(0, 4000) };
    if (draft_message_id) payload.message_id = Number(draft_message_id);
    else if (reply_to_message_id) payload.reply_to_message_id = Number(reply_to_message_id);
    try {
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: as_string(data.description || `http_${response.status}`) };
      }
      const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
      const draft_id = as_string(result.message_id || draft_message_id || "");
      return { ok: true, draft_id };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  /** Telegram Bot API 9.3 native streaming: 드래프트 메시지 시작. */
  async start_native_stream(chat_id: string, reply_to: string): Promise<{ ok: boolean; stream_id?: string; error?: string }> {
    const res = await this.send_draft(chat_id, "…", reply_to || undefined);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, stream_id: res.draft_id };
  }

  /** Telegram Bot API 9.3 native streaming: 드래프트 내용 갱신. */
  async append_native_stream(chat_id: string, stream_id: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.send_draft(chat_id, text, undefined, stream_id);
    return { ok: res.ok, error: res.error };
  }

  async edit_message(chat_id: string, message_id: string, content: string, parse_mode?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    if (!chat_id || !message_id) return { ok: false, error: "chat_id_and_message_id_required" };
    try {
      const url = `${this.api_base}/bot${this.bot_token}/editMessageText`;
      const payload: Record<string, unknown> = { chat_id, message_id: Number(message_id), text: String(content || "") };
      const resolved = this.resolve_parse_mode(parse_mode);
      if (resolved) payload.parse_mode = resolved;
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: as_string(data.description || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  async add_reaction(chat_id: string, message_id: string, reaction: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    if (!chat_id || !message_id || !reaction) return { ok: false, error: "chat_id_message_id_reaction_required" };
    try {
      const url = `${this.api_base}/bot${this.bot_token}/setMessageReaction`;
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          message_id: Number(message_id),
          reaction: [{ type: "emoji", emoji: reaction }],
        }),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: as_string(data.description || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  async remove_reaction(chat_id: string, message_id: string, _reaction: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    try {
      const url = `${this.api_base}/bot${this.bot_token}/setMessageReaction`;
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id, message_id: Number(message_id), reaction: [] }),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: as_string(data.description || `http_${response.status}`) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  async sync_commands(descriptors: CommandDescriptor[]): Promise<void> {
    if (!this.bot_token) return;
    const commands = descriptors.map((d) => ({
      command: d.name,
      description: d.description.slice(0, 256),
    }));
    try {
      const url = `${this.api_base}/bot${this.bot_token}/setMyCommands`;
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        this.last_error = as_string(data.description || `setMyCommands_http_${response.status}`);
      }
    } catch (error) {
      this.last_error = error_message(error);
      this.log.warn("sync_commands failed", { error: this.last_error });
    }
  }

  async send_poll(poll: import("./types.js").SendPollRequest): Promise<import("./types.js").SendPollResult> {
    if (!this.bot_token) return { ok: false, error: "telegram_bot_token_missing" };
    const chat_id = String(poll.chat_id || this.default_chat_id || "");
    if (!chat_id) return { ok: false, error: "chat_id_required" };
    if (!poll.options || poll.options.length < 2) return { ok: false, error: "at_least_2_options_required" };
    try {
      const payload: Record<string, unknown> = {
        chat_id,
        question: String(poll.question || "").slice(0, 300),
        options: JSON.stringify(poll.options.map((o) => String(o.text || "").slice(0, 100))),
        is_anonymous: poll.is_anonymous !== false,
        allows_multiple_answers: poll.allows_multiple_answers === true,
      };
      if (poll.open_period && poll.open_period > 0) {
        payload.open_period = Math.min(600, Math.max(5, poll.open_period));
      }
      if (poll.message_thread_id) {
        payload.message_thread_id = poll.message_thread_id;
      }
      const url = `${this.api_base}/bot${this.bot_token}/sendPoll`;
      const response = await channel_fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parse_json_response(response);
      if (!response.ok || data.ok !== true) {
        return { ok: false, error: as_string(data.description || `http_${response.status}`) };
      }
      const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
      return { ok: true, message_id: String(result.message_id || "") };
    } catch (error) {
      return { ok: false, error: error_message(error) };
    }
  }

  protected async set_typing_remote(chat_id: string, typing: boolean, _anchor_message_id?: string): Promise<void> {
    if (!typing) return;
    if (!this.bot_token) return;
    const url = `${this.api_base}/bot${this.bot_token}/sendChatAction`;
    await channel_fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, action: "typing" }),
    }).catch(() => {/* typing 실패는 무시 */});
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
    const response = await channel_fetch(url, { method: "POST", body: form });
    const data = await parse_json_response(response);
    if (!response.ok || data.ok !== true) {
      return { ok: false, error: as_string(data.description || `http_${response.status}`) };
    }
    const result = (data.result && typeof data.result === "object") ? (data.result as Record<string, unknown>) : {};
    return { ok: true, message_id: as_string(result.message_id || "") };
  }
}
