/**
 * GW-2: ChannelIngressNormalizer 테스트.
 *
 * 대상:
 * - normalize_ingress(): 채널별 메시지 정규화 (멘션 제거, 봇 커맨드 정리)
 */

import { describe, it, expect } from "vitest";
import { normalize_ingress } from "@src/orchestration/ingress-normalizer.js";
import type { InboundMessage } from "@src/bus/types.js";

function make_message(content: string, overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    id: "test-msg",
    provider: "web",
    channel: "web",
    sender_id: "user-1",
    chat_id: "chat-1",
    content,
    at: new Date().toISOString(),
    ...overrides,
  };
}

describe("normalize_ingress", () => {
  describe("Slack", () => {
    it("봇 멘션 접두사 제거", () => {
      const msg = make_message("<@U12345ABC> 오늘 날씨 어때?");
      const result = normalize_ingress(msg, "slack");
      expect(result.text).toBe("오늘 날씨 어때?");
    });

    it("멘션 없는 메시지 → 그대로 통과", () => {
      const msg = make_message("그냥 메시지");
      const result = normalize_ingress(msg, "slack");
      expect(result.text).toBe("그냥 메시지");
    });

    it("reply_ref에 thread_id 포함", () => {
      const msg = make_message("test", { thread_id: "T789" });
      const result = normalize_ingress(msg, "slack");
      expect(result.reply_ref.thread_id).toBe("T789");
    });
  });

  describe("Telegram", () => {
    it("/command@botname → /command (봇명 제거)", () => {
      const msg = make_message("/start@mybot");
      const result = normalize_ingress(msg, "telegram");
      expect(result.text).toBe("/start");
    });

    it("일반 메시지 → 그대로 통과", () => {
      const msg = make_message("안녕하세요");
      const result = normalize_ingress(msg, "telegram");
      expect(result.text).toBe("안녕하세요");
    });
  });

  describe("Web/기타", () => {
    it("web 메시지 → 그대로 통과", () => {
      const msg = make_message("hello world");
      const result = normalize_ingress(msg, "web");
      expect(result.text).toBe("hello world");
    });

    it("빈 메시지 → 빈 문자열", () => {
      const msg = make_message("");
      const result = normalize_ingress(msg, "web");
      expect(result.text).toBe("");
    });
  });

  describe("공통 필드", () => {
    it("provider 전달", () => {
      const msg = make_message("test");
      const result = normalize_ingress(msg, "slack");
      expect(result.provider).toBe("slack");
      expect(result.reply_ref.provider).toBe("slack");
    });

    it("chat_id 전달", () => {
      const msg = make_message("test", { chat_id: "C999" });
      const result = normalize_ingress(msg, "slack");
      expect(result.chat_id).toBe("C999");
      expect(result.reply_ref.chat_id).toBe("C999");
    });
  });
});
