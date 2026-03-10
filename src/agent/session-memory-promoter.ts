/**
 * 세션 만료 임박 메시지를 daily 메모리로 승격.
 * LLM 미사용 — 결정론적 추출, 0 추가 비용.
 *
 * 동작:
 * 1. 모든 세션을 순회하며 last_consolidated 이후 & 만료 절반 경과 메시지를 수집
 * 2. daily 메모리에 대화 발췌를 append
 * 3. session.last_consolidated를 갱신하여 중복 승격 방지
 */

import type { SessionStoreLike } from "../session/service.js";
import type { MemoryStoreLike } from "./memory.types.js";
import type { Logger } from "../logger.js";

export type SessionPromotionConfig = {
  /** 세션 히스토리 최대 수명 (ms). 절반 이상 지난 메시지를 승격 대상으로 삼음. */
  session_max_age_ms: number;
  /** 세션당 승격할 최대 교환 쌍 수 (user+assistant 1쌍 = 2메시지). */
  max_pairs: number;
  /** 메시지당 최대 문자 수. 초과 시 잘림 처리. */
  max_content_chars: number;
};

const DEFAULT_CONFIG: SessionPromotionConfig = {
  session_max_age_ms: 1_800_000,
  max_pairs: 5,
  max_content_chars: 400,
};

function format_promotion(
  session_key: string,
  messages: Array<{ role: string; content?: string; timestamp?: string }>,
  max_chars: number,
): string {
  const date = new Date().toISOString().slice(0, 10);
  // 세션 키에서 provider:chat_id:alias 부분만 추출 (thread_id 제거)
  const short_key = session_key.split(":").slice(0, 3).join(":");
  const lines = [`## Session ${date} — ${short_key}`];
  for (const msg of messages) {
    if (!msg.content?.trim()) continue;
    const label = msg.role === "user" ? "User" : "Bot";
    const ts = msg.timestamp ? new Date(msg.timestamp).toISOString().slice(11, 16) : "";
    const body = msg.content.length > max_chars
      ? msg.content.slice(0, max_chars - 1) + "…"
      : msg.content;
    lines.push(`[${ts}] **${label}:** ${body}`);
  }
  return lines.join("\n");
}

/**
 * 만료 임박 세션 메시지를 daily 메모리로 승격.
 * MemoryConsolidationService.run_consolidation() 끝에서 호출.
 */
export async function promote_sessions_to_daily(
  sessions: SessionStoreLike,
  memory: MemoryStoreLike,
  logger: Logger,
  config: Partial<SessionPromotionConfig> = {},
): Promise<{ promoted: number; skipped: number }> {
  if (!sessions.list_by_prefix) return { promoted: 0, skipped: 0 };

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  /** 이 시각보다 오래된 메시지는 곧 만료 → 승격 대상. */
  const promotion_horizon = now - cfg.session_max_age_ms * 0.5;

  const entries = await sessions.list_by_prefix("", 500).catch(() => []);
  let promoted = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      const session = await sessions.get_or_create(entry.key);

      // last_consolidated 이후 & promotion_horizon 이전 메시지
      const pending = session.messages.filter((msg) => {
        const ts = msg.timestamp ? Date.parse(String(msg.timestamp)) : 0;
        return ts > session.last_consolidated && ts < promotion_horizon;
      });

      if (pending.length < 2) { skipped++; continue; } // user+assistant 최소 1쌍

      const to_promote = pending.slice(-cfg.max_pairs * 2);
      const formatted = format_promotion(session.key, to_promote, cfg.max_content_chars);
      await memory.append_daily(`\n${formatted}\n`);

      // 승격 완료 표시 — 마지막 메시지 타임스탬프로 갱신
      const last_ts = to_promote.at(-1)?.timestamp;
      if (last_ts) {
        session.last_consolidated = Date.parse(String(last_ts));
        await sessions.save(session);
      }

      promoted++;
      logger.debug("session promoted to daily", { key: entry.key, messages: to_promote.length });
    } catch (e) {
      logger.debug("session promotion skipped", { key: entry.key, error: String(e) });
      skipped++;
    }
  }

  return { promoted, skipped };
}
