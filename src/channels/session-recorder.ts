import { error_message, now_iso, normalize_text } from "../utils/common.js";
import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "./types.js";
import type { SessionStoreLike } from "../session/service.js";
import type { Logger } from "../logger.js";

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

export interface DailyMemoryWriter {
  append_daily_memory(line: string): Promise<void>;
}

export type MirrorMessageEvent = {
  session_key: string;
  direction: "user" | "assistant";
  sender_id: string;
  content: string;
  at: string;
};

export type SessionRecorderDeps = {
  sessions: SessionStoreLike | null;
  daily_memory: DailyMemoryWriter | null;
  sanitize_for_storage: (text: string) => string;
  logger: Logger;
  on_mirror_message?: (event: MirrorMessageEvent) => void;
};

export class SessionRecorder {
  private readonly sessions: SessionStoreLike | null;
  private readonly daily_memory: DailyMemoryWriter | null;
  private readonly sanitize: (text: string) => string;
  private readonly logger: Logger;
  private readonly on_mirror: ((event: MirrorMessageEvent) => void) | null;

  constructor(deps: SessionRecorderDeps) {
    this.sessions = deps.sessions;
    this.daily_memory = deps.daily_memory;
    this.sanitize = deps.sanitize_for_storage;
    this.logger = deps.logger;
    this.on_mirror = deps.on_mirror_message || null;
  }

  async record_user(provider: ChannelProvider, message: InboundMessage, alias: string): Promise<void> {
    if (!this.sessions) return;
    try {
      const tid = extract_team_id(message.metadata);
      const key = session_key(provider, message.chat_id, alias, message.thread_id, tid || undefined);
      const safe = this.sanitize(String(message.content || ""));
      const ts = now_iso();
      const msg = {
        role: "user" as const,
        content: safe,
        timestamp: ts,
        sender_id: message.sender_id,
        at: message.at,
        thread_id: message.thread_id,
      };
      await this.sessions.append_message(key, msg);
      this.emit_mirror(key, "user", message.sender_id, safe, ts);
      await this.append_daily("user", provider, message.chat_id, message.thread_id, message.sender_id, safe);
    } catch (e) {
      this.logger.debug("record_user failed", { error: error_message(e) });
    }
  }

  async record_assistant(
    provider: ChannelProvider, message: InboundMessage, alias: string, content: string,
    metadata?: { stream_full_content?: string; parsed_output?: unknown; tool_calls_count?: number; run_id?: string; usage?: Record<string, unknown>; tools_used?: string[] },
  ): Promise<void> {
    if (!this.sessions) return;
    try {
      const tid = extract_team_id(message.metadata);
      const key = session_key(provider, message.chat_id, alias, message.thread_id, tid || undefined);
      const safe = this.sanitize(String(content || ""));
      const ts = now_iso();
      const msg = {
        role: "assistant" as const,
        content: safe,
        timestamp: ts,
        sender_id: alias,
        at: ts,
        thread_id: message.thread_id,
        ...(metadata?.stream_full_content ? { stream_full_content: metadata.stream_full_content } : {}),
        ...(metadata?.parsed_output !== undefined ? { parsed_output: metadata.parsed_output } : {}),
        ...(metadata?.tool_calls_count ? { tool_calls_count: metadata.tool_calls_count } : {}),
        ...(metadata?.run_id ? { run_id: metadata.run_id } : {}),
        ...(metadata?.usage ? { usage: metadata.usage } : {}),
        ...(metadata?.tools_used?.length ? { tools_used: metadata.tools_used } : {}),
      };
      await this.sessions.append_message(key, msg);
      this.emit_mirror(key, "assistant", alias, safe, ts);
      await this.append_daily("assistant", provider, message.chat_id, message.thread_id, alias, safe);
    } catch (e) {
      this.logger.debug("record_assistant failed", { error: error_message(e) });
    }
  }

  async get_history(
    provider: ChannelProvider,
    chat_id: string,
    alias: string,
    thread_id: string | undefined,
    max_messages: number,
    max_age_ms: number,
    team_id?: string,
  ): Promise<ChatMessage[]> {
    if (!this.sessions) return [];
    try {
      const key = session_key(provider, chat_id, alias, thread_id, team_id);
      // DB에서 직접 로드하여 재시작 후에도 최신 데이터 보장
      const session = await this.sessions.get_or_create(key);
      const now = Date.now();
      return session.messages
        .filter((row) => {
          if (max_age_ms <= 0) return true;
          const rec = row as Record<string, unknown>;
          const ts_raw = String(rec.timestamp || rec.at || "");
          if (!ts_raw) return true;
          const ts = Date.parse(ts_raw);
          return !Number.isFinite(ts) || now - ts <= max_age_ms;
        })
        .slice(-Math.max(1, max_messages))
        .map((r) => ({
          role: String(r.role || "user") as ChatMessage["role"],
          content: String(r.content || ""),
        }))
        .filter((r) => Boolean(r.content));
    } catch {
      return [];
    }
  }

  /**
   * Webhook retry 감지: `user:Q → assistant:A(recent) → user:Q(incoming)` 패턴 확인.
   *
   * Slack은 응답이 늦으면 동일 이벤트를 재전송. 직전 응답 후 within_ms 이내에
   * 동일 내용이 다시 도착하면 retry로 판정 → 중복 처리 방지.
   */
  async is_delivery_retry(
    provider: ChannelProvider,
    message: InboundMessage,
    alias: string,
    within_ms = 3_000,
  ): Promise<boolean> {
    if (!this.sessions) return false;
    try {
      const tid = extract_team_id(message.metadata);
      const key = session_key(provider, message.chat_id, alias, message.thread_id, tid || undefined);
      const session = await this.sessions.get_or_create(key);
      const msgs = session.messages;
      if (msgs.length < 2) return false;

      const content = String(message.content || "").trim();
      if (!content) return false;
      const now = Date.now();

      // 역순으로 가장 최근 assistant 메시지를 찾아 within_ms 이내인지 확인
      for (let i = msgs.length - 1; i >= 1; i--) {
        const cur = msgs[i] as Record<string, unknown>;
        if (cur.role !== "assistant") continue;

        const ts_raw = String(cur.timestamp || cur.at || "");
        if (!ts_raw) break;
        const ts = Date.parse(ts_raw);
        if (!Number.isFinite(ts) || now - ts > within_ms) break; // 오래된 응답 → retry 아님

        // 직전 user 메시지와 현재 content 비교
        const prev = msgs[i - 1] as Record<string, unknown>;
        if (prev.role !== "user") continue;
        if (String(prev.content || "").trim() === content) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 지정 채널의 마지막 assistant 메시지 content 조회. /verify 등에서 사용. */
  async get_last_assistant_content(provider: ChannelProvider, chat_id: string, alias: string, team_id?: string): Promise<string | null> {
    if (!this.sessions) return null;
    try {
      const key = session_key(provider, chat_id, alias, undefined, team_id);
      const session = await this.sessions.get_or_create(key);
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.role === "assistant" && msg.content) return String(msg.content);
      }
      return null;
    } catch {
      return null;
    }
  }

  private emit_mirror(session_key: string, direction: "user" | "assistant", sender_id: string, content: string, at: string): void {
    if (!this.on_mirror) return;
    try { this.on_mirror({ session_key, direction, sender_id, content, at }); } catch { /* observer failure won't block recording */ }
  }

  private async append_daily(
    role: "user" | "assistant",
    provider: ChannelProvider,
    chat_id: string,
    thread_id: string | undefined,
    sender_id: string,
    content: string,
  ): Promise<void> {
    if (!this.daily_memory) return;
    const text = normalize_text(content).slice(0, 1600);
    if (!text) return;
    const thread = thread_id?.trim() || "-";
    const sender = sender_id?.trim() || "unknown";
    const line = `- [${now_iso()}] [${provider}:${chat_id}:${thread}] ${role.toUpperCase()}(${sender}): ${text}\n`;
    try { await this.daily_memory.append_daily_memory(line); }
    catch (error) { this.logger.warn("daily memory write failed", { error: error_message(error) }); }
  }
}

function extract_team_id(metadata?: Record<string, unknown>): string {
  return typeof metadata?.team_id === "string" ? metadata.team_id : "";
}

function session_key(provider: ChannelProvider, chat_id: string, alias: string, thread_id?: string, team_id?: string): string {
  const thread = thread_id?.trim() || "main";
  return team_id
    ? `${provider}:${team_id}:${chat_id}:${alias}:${thread}`
    : `${provider}:${chat_id}:${alias}:${thread}`;
}
