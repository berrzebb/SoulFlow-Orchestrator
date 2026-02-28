import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "./types.js";
import type { SessionStoreLike } from "../session/service.js";
import type { Logger } from "../logger.js";

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string };

export interface DailyMemoryWriter {
  append_daily_memory(line: string): Promise<void>;
}

export type SessionRecorderDeps = {
  sessions: SessionStoreLike | null;
  daily_memory: DailyMemoryWriter | null;
  sanitize_for_storage: (text: string) => string;
  logger: Logger;
};

export class SessionRecorder {
  private readonly sessions: SessionStoreLike | null;
  private readonly daily_memory: DailyMemoryWriter | null;
  private readonly sanitize: (text: string) => string;
  private readonly logger: Logger;

  constructor(deps: SessionRecorderDeps) {
    this.sessions = deps.sessions;
    this.daily_memory = deps.daily_memory;
    this.sanitize = deps.sanitize_for_storage;
    this.logger = deps.logger;
  }

  async record_user(provider: ChannelProvider, message: InboundMessage, alias: string): Promise<void> {
    if (!this.sessions) return;
    try {
      const key = session_key(provider, message.chat_id, alias, message.thread_id);
      const session = await this.sessions.get_or_create(key);
      const safe = this.sanitize(String(message.content || ""));
      session.add_message("user", safe, {
        sender_id: message.sender_id,
        at: message.at,
        thread_id: message.thread_id,
      });
      await this.sessions.save(session);
      await this.append_daily("user", provider, message.chat_id, message.thread_id, message.sender_id, safe);
    } catch (e) {
      this.logger.debug("record_user failed", { error: String(e) });
    }
  }

  async record_assistant(provider: ChannelProvider, message: InboundMessage, alias: string, content: string): Promise<void> {
    if (!this.sessions) return;
    try {
      const key = session_key(provider, message.chat_id, alias, message.thread_id);
      const session = await this.sessions.get_or_create(key);
      const safe = this.sanitize(String(content || ""));
      session.add_message("assistant", safe, {
        sender_id: alias,
        at: new Date().toISOString(),
        thread_id: message.thread_id,
      });
      await this.sessions.save(session);
      await this.append_daily("assistant", provider, message.chat_id, message.thread_id, alias, safe);
    } catch (e) {
      this.logger.debug("record_assistant failed", { error: String(e) });
    }
  }

  async get_history(
    provider: ChannelProvider,
    chat_id: string,
    alias: string,
    thread_id: string | undefined,
    max_messages: number,
    max_age_ms: number,
  ): Promise<ChatMessage[]> {
    if (!this.sessions) return [];
    try {
      const key = session_key(provider, chat_id, alias, thread_id);
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

  private async append_daily(
    role: "user" | "assistant",
    provider: ChannelProvider,
    chat_id: string,
    thread_id: string | undefined,
    sender_id: string,
    content: string,
  ): Promise<void> {
    if (!this.daily_memory) return;
    const text = content.replace(/\s+/g, " ").trim().slice(0, 1600);
    if (!text) return;
    const thread = thread_id?.trim() || "-";
    const sender = sender_id?.trim() || "unknown";
    const line = `- [${new Date().toISOString()}] [${provider}:${chat_id}:${thread}] ${role.toUpperCase()}(${sender}): ${text}\n`;
    try { await this.daily_memory.append_daily_memory(line); }
    catch (error) { this.logger.warn("daily memory write failed", { error: error instanceof Error ? error.message : String(error) }); }
  }
}

function session_key(provider: ChannelProvider, chat_id: string, alias: string, thread_id?: string): string {
  const thread = thread_id?.trim() || "main";
  return `${provider}:${chat_id}:${alias}:${thread}`;
}
