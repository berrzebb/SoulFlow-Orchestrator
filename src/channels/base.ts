import { randomUUID } from "node:crypto";
import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import { now_iso } from "../utils/common.js";
import type { AgentMention, ChannelCommand, ChannelHealth, ChannelProvider, ChannelTypingState, ChatChannel, FileRequestResult } from "./types.js";

export abstract class BaseChannel implements ChatChannel {
  readonly provider: ChannelProvider;
  protected running = false;
  protected last_error = "";
  protected readonly typing_state = new Map<string, ChannelTypingState>();

  protected constructor(provider: ChannelProvider) {
    this.provider = provider;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }>;
  abstract read(chat_id: string, limit?: number): Promise<InboundMessage[]>;
  protected abstract set_typing_remote(chat_id: string, typing: boolean): Promise<void>;

  is_running(): boolean {
    return this.running;
  }

  async set_typing(chat_id: string, typing: boolean): Promise<void> {
    const normalized = String(chat_id || "");
    if (!normalized) return;
    this.typing_state.set(normalized, {
      chat_id: normalized,
      typing,
      updated_at: now_iso(),
    });
    try {
      await this.set_typing_remote(normalized, typing);
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
    }
  }

  get_typing_state(chat_id: string): ChannelTypingState {
    return (
      this.typing_state.get(chat_id) || {
        chat_id,
        typing: false,
        updated_at: now_iso(),
      }
    );
  }

  async send_command(chat_id: string, command: string, args?: string[]): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const line = `/${command}${Array.isArray(args) && args.length > 0 ? ` ${args.join(" ")}` : ""}`;
    return this.send({
      id: randomUUID().slice(0, 12),
      provider: this.provider,
      channel: this.provider,
      sender_id: "agent",
      chat_id,
      content: line,
      at: now_iso(),
      metadata: {
        kind: "command",
      },
    });
  }

  async request_file(chat_id: string, prompt: string, accept?: string[]): Promise<FileRequestResult> {
    const request_id = randomUUID().slice(0, 12);
    const content = [
      `[FILE_REQUEST id=${request_id}]`,
      prompt,
      Array.isArray(accept) && accept.length > 0 ? `accepted_types: ${accept.join(", ")}` : "",
    ].filter(Boolean).join("\n");
    const result = await this.send({
      id: randomUUID().slice(0, 12),
      provider: this.provider,
      channel: this.provider,
      sender_id: "agent",
      chat_id,
      content,
      at: now_iso(),
      metadata: {
        kind: "file_request",
        request_id,
        accept: accept || [],
      },
    });
    return {
      ok: result.ok,
      request_id,
      chat_id,
      message: result.ok ? "file request sent" : undefined,
      error: result.error,
    };
  }

  async send_agent_mention(
    chat_id: string,
    from_alias: string,
    to_alias: string,
    message: string,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const content = `[AGENT-MENTION] from=@${from_alias} to=@${to_alias}\n@${to_alias} ${message}`;
    return this.send({
      id: randomUUID().slice(0, 12),
      provider: this.provider,
      channel: this.provider,
      sender_id: from_alias,
      chat_id,
      content,
      at: now_iso(),
      metadata: {
        kind: "agent_mention",
        from_alias,
        to_alias,
      },
    });
  }

  parse_command(content: string): ChannelCommand | null {
    const trimmed = String(content || "").trim();
    if (!trimmed.startsWith("/")) return null;
    const parts = trimmed.split(/\s+/);
    const command = parts[0].replace(/^\//, "").trim();
    if (!command) return null;
    return {
      raw: trimmed,
      name: command,
      args: parts.slice(1),
    };
  }

  parse_agent_mentions(content: string): AgentMention[] {
    const text = String(content || "");
    const out: AgentMention[] = [];
    const seen = new Set<string>();

    const slackIdMatches = [...text.matchAll(/<@([A-Za-z0-9._-]+)>/g)];
    for (const m of slackIdMatches) {
      const alias = String(m[1] || "").trim();
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw: String(m[0] || `@${alias}`), alias });
    }

    const plainMatches = text.match(/@[A-Za-z0-9._-]+/g) || [];
    for (const raw of plainMatches) {
      const alias = raw.slice(1).trim();
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ raw, alias });
    }
    return out;
  }

  get_health(): ChannelHealth {
    return {
      provider: this.provider,
      running: this.running,
      last_error: this.last_error || undefined,
    };
  }
}
