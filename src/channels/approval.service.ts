import { now_iso } from "../utils/common.js";
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

export type ApprovalHandleResult = {
  handled: boolean;
  /** 승인된 요청에 연결된 Task ID — ChannelManager가 task loop 재개에 사용. */
  task_id?: string;
  /** 승인 후 도구 실행 결과 요약 — task memory에 주입하여 컨텍스트 유지. */
  tool_result?: string;
  /** 승인 요청의 최종 상태. denied/cancelled 시 Task 취소에 사용. */
  approval_status?: "approved" | "denied" | "deferred" | "cancelled" | "clarify";
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

  async try_handle_text_reply(provider: ChannelProvider, message: InboundMessage): Promise<ApprovalHandleResult> {
    if (!this.runtime) return { handled: false };
    const text = String(message.content || "").trim();
    if (!text) return { handled: false };

    const pending = this.runtime.list_approval_requests("pending");
    if (pending.length === 0) return { handled: false };

    const explicit_id = extract_request_id(text);
    const same_chat = pending.filter((r) =>
      String(r.context?.channel || "").toLowerCase() === provider &&
      String(r.context?.chat_id || "") === String(message.chat_id || ""),
    );
    const selected = (explicit_id ? pending.find((r) => r.request_id === explicit_id) : same_chat[0]) || null;
    if (!selected) return { handled: false };

    return this.apply_decision(provider, message, selected.request_id, text, "text");
  }

  async try_handle_approval_reactions(provider: ChannelProvider, rows: InboundMessage[]): Promise<ApprovalHandleResult> {
    if (!this.runtime) return { handled: false };
    const pending = this.runtime.list_approval_requests("pending");
    if (pending.length === 0) return { handled: false };

    for (const row of rows.slice(0, 80)) {
      const names = extract_reaction_names(row);
      if (names.length === 0) continue;
      const decision = reaction_to_decision(names);
      if (!decision) continue;

      // request_id가 content에 있으면 직접 매칭, 없으면 chat_id로 매칭 (Telegram 리액션)
      const explicit_id = extract_request_id(String(row.content || ""));
      const request = explicit_id
        ? pending.find((p) => p.request_id === explicit_id)
        : pending.find((p) =>
            String(p.context?.channel || "").toLowerCase() === provider &&
            String(p.context?.chat_id || "") === String(row.chat_id || ""),
          );
      if (!request) continue;

      const sig = `${provider}:${row.chat_id}:${request.request_id}:${decision}:${names.sort().join(",")}`;
      if (this.reaction_seen.has(sig)) continue;
      this.reaction_seen.set(sig, Date.now());
      const emoji = decision === "approve" ? "\u2705" : decision === "deny" ? "\u274c" : decision === "defer" ? "\u23f8\ufe0f" : "\u26d4";
      return this.apply_decision(provider, row, request.request_id, emoji, "reaction");
    }
    return { handled: false };
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
  ): Promise<ApprovalHandleResult> {
    if (!this.runtime) return { handled: false };
    const selected = this.runtime.get_approval_request(request_id);
    if (!selected) return { handled: false };

    const resolved = this.runtime.resolve_approval_request(request_id, decision_input);
    if (!resolved.ok) return { handled: false };

    let content: string;
    let tool_result: string | undefined;
    if (resolved.status === "approved") {
      const executed = await this.runtime.execute_approved_request(request_id);
      if (executed.ok) {
        tool_result = String(executed.result || "").slice(0, 2000);
        content = `\u2705 승인을 확인했습니다. 차단된 작업을 재개합니다.`;
      } else {
        this.logger.warn("approval_execute_failed", {
          request_id, tool_name: executed.tool_name || selected.tool_name,
          error: String(executed.error || "unknown_error").slice(0, 220),
        });
        content = `\ud83d\udd34 승인 반영 실패(${source}) \u00b7 tool=${executed.tool_name || selected.tool_name}\n${String(executed.error || "unknown_error").slice(0, 220)}`;
      }
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
      at: now_iso(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "approval_result",
        request_id: selected.request_id,
        tool_name: selected.tool_name,
        decision: resolved.decision,
      },
    });

    const task_id = selected.context?.task_id;
    this.logger.info("approval_decision", {
      request_id: selected.request_id,
      tool_name: selected.tool_name,
      status: resolved.status,
      source,
      task_id: task_id || null,
    });
    return { handled: true, task_id, tool_result, approval_status: resolved.status as ApprovalHandleResult["approval_status"] };
  }
}

function extract_request_id(text: string): string | null {
  const m = text.match(/\brequest[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i)
    || text.match(/\bapproval[_\s-]?request[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i);
  return m ? (m[1]?.trim() || null) : null;
}

export function extract_reaction_names(message: InboundMessage): string[] {
  const meta = (message.metadata || {}) as Record<string, unknown>;

  // Slack: metadata.slack.reactions
  const slack = (meta.slack && typeof meta.slack === "object") ? meta.slack as Record<string, unknown> : null;
  if (slack) {
    const reactions = Array.isArray(slack.reactions) ? slack.reactions as Array<Record<string, unknown>> : [];
    return reactions.map((r) => String(r.name || "").trim().toLowerCase()).filter(Boolean);
  }

  // Telegram: metadata.telegram_reaction.emoji
  const tg = (meta.telegram_reaction && typeof meta.telegram_reaction === "object")
    ? meta.telegram_reaction as Record<string, unknown>
    : null;
  if (tg) {
    const emoji_list = Array.isArray(tg.emoji) ? tg.emoji as string[] : [];
    return emoji_list.map((e) => EMOJI_TO_REACTION[e] || e).filter(Boolean);
  }

  // Discord: metadata.discord.reactions
  const discord = (meta.discord && typeof meta.discord === "object") ? meta.discord as Record<string, unknown> : null;
  if (discord) {
    const reactions = Array.isArray(discord.reactions) ? discord.reactions as Array<Record<string, unknown>> : [];
    return reactions
      .map((r) => {
        const emoji = (r.emoji && typeof r.emoji === "object") ? r.emoji as Record<string, unknown> : null;
        return String(emoji?.name || "").trim().toLowerCase();
      })
      .filter(Boolean);
  }

  return [];
}

/** Telegram 이모지 → Slack-style 리액션 이름 매핑. */
const EMOJI_TO_REACTION: Record<string, string> = {
  "\u{1F44D}": "thumbsup", "\u2705": "white_check_mark", "\u2714\uFE0F": "heavy_check_mark",
  "\u{1F49A}": "green_heart", "\u{1F7E2}": "large_green_circle", "\u{1F44C}": "ok_hand",
  "\u274C": "x", "\u{1F44E}": "thumbsdown", "\u26D4": "no_entry",
  "\u{1F6AB}": "no_entry_sign", "\u{1F534}": "red_circle",
  "\u23F8\uFE0F": "pause_button", "\u23F3": "hourglass_flowing_sand",
  "\u231B": "hourglass", "\u{1F914}": "thinking_face",
  "\u{1F6D1}": "octagonal_sign",
};

const APPROVE = ["white_check_mark", "heavy_check_mark", "thumbsup", "+1", "green_heart", "large_green_circle", "ok_hand"];
const DENY = ["x", "thumbsdown", "-1", "no_entry", "no_entry_sign", "red_circle"];
const DEFER = ["hourglass_flowing_sand", "hourglass", "pause_button", "thinking_face"];
const CANCEL = ["octagonal_sign", "stop_sign"];

/** 리액션 이름이 실행 중지 컨트롤인지 판별. */
export function is_control_stop_reaction(names: string[]): boolean {
  return CANCEL.some((n) => names.includes(n));
}

function reaction_to_decision(names: string[]): "approve" | "deny" | "defer" | "cancel" | null {
  const set = new Set(names);
  if (APPROVE.some((n) => set.has(n))) return "approve";
  if (DENY.some((n) => set.has(n))) return "deny";
  if (DEFER.some((n) => set.has(n))) return "defer";
  if (CANCEL.some((n) => set.has(n))) return "cancel";
  return null;
}
