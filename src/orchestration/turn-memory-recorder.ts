/**
 * 오케스트레이터 레벨 턴 기록기.
 * 에이전트가 memory 도구를 호출하지 않아도 매 턴마다 대화 발췌를 daily 메모리에 기록.
 * fire-and-forget — 실패해도 응답에 영향 없음.
 */

import type { OrchestrationRequest, OrchestrationResult } from "./types.js";
import type { MemoryStoreLike } from "../agent/memory.types.js";
import type { MemoryIngestionReducer } from "./memory-ingestion-reducer.js";

const MAX_CONTENT_CHARS = 600;

function truncate(text: string): string {
  return text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS - 1) + "…" : text;
}

/**
 * 한 턴(user + bot)을 daily 메모리에 append.
 * 에러/suppress/builtin 결과는 건너뜀.
 *
 * reducer 제공 시 bot reply에 storage_text 기준 reduction 적용.
 * 미제공 시 기존 MAX_CONTENT_CHARS truncation으로 fallback.
 */
export function record_turn_to_daily(
  req: OrchestrationRequest,
  result: OrchestrationResult,
  memory: MemoryStoreLike | null | undefined,
  reducer?: MemoryIngestionReducer,
): void {
  if (!memory) return;
  if (result.error || result.suppress_reply || result.builtin_command) return;
  if (!result.reply) return;

  const user_text = req.message.content?.trim();
  const bot_text = result.reply.trim();
  if (!user_text || !bot_text) return;

  const now = new Date();
  const hhmm = now.toISOString().slice(11, 16);
  // provider:chat_id:alias 형식으로 출처 표기
  const source = `${req.provider}:${req.message.chat_id}:${req.alias}`;
  const stored_bot = reducer ? reducer.reduce(bot_text) : truncate(bot_text);

  const entry = [
    `### ${source} ${hhmm}`,
    `**User:** ${truncate(user_text)}`,
    `**Bot:** ${stored_bot}`,
    "",
  ].join("\n");

  // best-effort: 실패해도 응답에 영향 없음
  memory.append_daily(entry).catch(() => {});
}
