/**
 * GW-2: ChannelIngressNormalizer — 채널 요청을 정규화된 형태로 변환.
 *
 * 채널별 메시지 형식 차이(Slack thread_id, Telegram 멘션 접두사 등)를 흡수하여
 * 분류기와 실행 계획이 채널 중립적으로 동작하도록 보장.
 */

import type { InboundMessage } from "../bus/types.js";
import type { ChannelProvider } from "../channels/types.js";
import type { ReplyChannelRef } from "./gateway-contracts.js";
import { build_reply_ref } from "./gateway-contracts.js";

/** 정규화된 ingress 요청. 채널 차이가 흡수된 상태. */
export type NormalizedIngress = {
  text: string;
  reply_ref: ReplyChannelRef;
  provider: ChannelProvider;
  chat_id: string;
};

/** 채널별 봇 멘션 패턴. */
const BOT_MENTION_RE = /^<@[A-Z0-9]+>\s*/;
const TELEGRAM_CMD_RE = /^\/\w+@\w+/;

/** 채널 요청 정규화. 멘션 접두사 제거 + reply_ref 추출. */
export function normalize_ingress(
  message: InboundMessage,
  provider: ChannelProvider,
): NormalizedIngress {
  let text = String(message.content || "").trim();

  // Slack: <@BOT_ID> 멘션 접두사 제거
  if (provider === "slack") {
    text = text.replace(BOT_MENTION_RE, "").trim();
  }

  // Telegram: /command@botname 형식에서 @botname 제거
  if (provider === "telegram" && TELEGRAM_CMD_RE.test(text)) {
    text = text.replace(/@\w+/, "").trim();
  }

  const reply_ref = build_reply_ref(provider, message.chat_id, message.thread_id);

  return { text, reply_ref, provider, chat_id: message.chat_id };
}
