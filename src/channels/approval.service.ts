import type { InboundMessage, OutboundMessage } from "../bus/types.js";
import type { Logger } from "../logger.js";
import type { ChannelProvider } from "./types.js";
import type { AgentRuntimeLike } from "../agent/runtime.types.js";

type SendReply = (provider: ChannelProvider, message: OutboundMessage) => Promise<{ ok: boolean }>;

export type ApprovalServiceDeps = {
  agent_runtime: AgentRuntimeLike | null;
  send_reply: SendReply;
  resolve_reply_to: (provider: ChannelProvider, message: InboundMessage) => string;
  logger: Logger;
};

export class ApprovalService {
  private readonly runtime: AgentRuntimeLike | null;
  private readonly send: SendReply;
  private readonly resolve_reply_to: (provider: ChannelProvider, message: InboundMessage) => string;
  private readonly logger: Logger;
  private readonly reaction_seen = new Map<string, number>();

  constructor(deps: ApprovalServiceDeps) {
    this.runtime = deps.agent_runtime;
    this.send = deps.send_reply;
    this.resolve_reply_to = deps.resolve_reply_to;
    this.logger = deps.logger;
  }

  async try_handle_text_reply(provider: ChannelProvider, message: InboundMessage): Promise<boolean> {
    if (!this.runtime) return false;
    const text = String(message.content || "").trim();
    if (!text) return false;

    const pending = this.runtime.list_approval_requests("pending");
    if (pending.length === 0) return false;

    const explicit_id = extract_request_id(text);
    const same_chat = pending.filter((r) =>
      String(r.context?.channel || "").toLowerCase() === provider &&
      String(r.context?.chat_id || "") === String(message.chat_id || ""),
    );
    const selected = (explicit_id ? pending.find((r) => r.request_id === explicit_id) : same_chat[0]) || null;
    if (!selected) return false;

    return this.apply_decision(provider, message, selected.request_id, text, "text");
  }

  async try_handle_approval_reactions(provider: ChannelProvider, rows: InboundMessage[]): Promise<void> {
    if (!this.runtime || provider !== "slack") return;
    const pending = this.runtime.list_approval_requests("pending");
    if (pending.length === 0) return;

    for (const row of rows.slice(0, 80)) {
      const request_id = extract_request_id(String(row.content || ""));
      if (!request_id) continue;
      const request = pending.find((p) => p.request_id === request_id);
      if (!request) continue;
      const names = extract_reaction_names(row);
      if (names.length === 0) continue;
      const decision = reaction_to_decision(names);
      if (!decision) continue;
      const sig = `${provider}:${row.chat_id}:${request_id}:${decision}:${names.sort().join(",")}`;
      if (this.reaction_seen.has(sig)) continue;
      this.reaction_seen.set(sig, Date.now());
      const emoji = decision === "approve" ? "\u2705" : decision === "deny" ? "\u274c" : decision === "defer" ? "\u23f8\ufe0f" : "\u26d4";
      await this.apply_decision(provider, row, request_id, emoji, "reaction");
      return;
    }
  }

  prune_seen(ttl_ms: number, max_size: number): void {
    const now = Date.now();
    for (const [key, ts] of this.reaction_seen) {
      if (now - ts > ttl_ms) this.reaction_seen.delete(key);
    }
    let overflow = this.reaction_seen.size - max_size;
    if (overflow <= 0) return;
    for (const key of this.reaction_seen.keys()) {
      if (overflow-- <= 0) break;
      this.reaction_seen.delete(key);
    }
  }

  private async apply_decision(
    provider: ChannelProvider,
    message: InboundMessage,
    request_id: string,
    decision_input: string,
    source: "text" | "reaction",
  ): Promise<boolean> {
    if (!this.runtime) return false;
    const selected = this.runtime.get_approval_request(request_id);
    if (!selected) return false;

    const resolved = this.runtime.resolve_approval_request(request_id, decision_input);
    if (!resolved.ok) return false;

    let content: string;
    if (resolved.status === "approved") {
      const executed = await this.runtime.execute_approved_request(request_id);
      content = executed.ok
        ? `\u2705 승인 반영 완료(${source}) \u00b7 tool=${executed.tool_name}\n${String(executed.result || "").slice(0, 700)}`
        : `\ud83d\udd34 승인 반영 실패(${source}) \u00b7 tool=${executed.tool_name || selected.tool_name}\n${String(executed.error || "unknown_error").slice(0, 220)}`;
    } else {
      const label = resolved.status === "denied" ? "\u274c 승인 거부됨"
        : resolved.status === "deferred" ? "\u23f8\ufe0f 승인 보류됨"
        : resolved.status === "cancelled" ? "\u26d4 승인 취소됨"
        : "\u2139\ufe0f 승인 판단 보류";
      content = `${label}(${source}) \u00b7 request_id=${selected.request_id} \u00b7 tool=${selected.tool_name}`;
    }

    await this.send(provider, {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: "approval-bot",
      chat_id: message.chat_id,
      content,
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "approval_result",
        request_id: selected.request_id,
        tool_name: selected.tool_name,
        decision: resolved.decision,
      },
    });
    return true;
  }
}

function extract_request_id(text: string): string | null {
  const m = text.match(/\brequest[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i)
    || text.match(/\bapproval[_\s-]?request[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i);
  return m ? (m[1]?.trim() || null) : null;
}

function extract_reaction_names(message: InboundMessage): string[] {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  const slack = (meta.slack && typeof meta.slack === "object") ? meta.slack as Record<string, unknown> : null;
  if (!slack) return [];
  const reactions = Array.isArray(slack.reactions) ? slack.reactions as Array<Record<string, unknown>> : [];
  return reactions.map((r) => String(r.name || "").trim().toLowerCase()).filter(Boolean);
}

const APPROVE = ["white_check_mark", "heavy_check_mark", "thumbsup", "+1", "green_heart", "large_green_circle", "ok_hand"];
const DENY = ["x", "thumbsdown", "-1", "no_entry", "no_entry_sign", "red_circle"];
const DEFER = ["hourglass_flowing_sand", "hourglass", "pause_button", "thinking_face"];
const CANCEL = ["octagonal_sign", "stop_sign"];

function reaction_to_decision(names: string[]): "approve" | "deny" | "defer" | "cancel" | null {
  const set = new Set(names);
  if (APPROVE.some((n) => set.has(n))) return "approve";
  if (DENY.some((n) => set.has(n))) return "deny";
  if (DEFER.some((n) => set.has(n))) return "defer";
  if (CANCEL.some((n) => set.has(n))) return "cancel";
  return null;
}
