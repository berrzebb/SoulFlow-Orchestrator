import { describe, it, expect } from "vitest";
import { DefaultOutboundDedupePolicy } from "@src/channels/outbound-dedupe.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_message(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    content: "hello",
    chat_id: "ch1",
    ...overrides,
  } as OutboundMessage;
}

describe("DefaultOutboundDedupePolicy", () => {
  const policy = new DefaultOutboundDedupePolicy();

  describe("기본 키 생성", () => {
    it("같은 메시지 → 같은 키", () => {
      const msg = make_message({ content: "test", chat_id: "ch1" });
      expect(policy.key("telegram", msg)).toBe(policy.key("telegram", msg));
    });

    it("다른 content → 다른 키", () => {
      const a = make_message({ content: "hello" });
      const b = make_message({ content: "world" });
      expect(policy.key("telegram", a)).not.toBe(policy.key("telegram", b));
    });

    it("다른 chat_id → 다른 키", () => {
      const a = make_message({ chat_id: "ch1" });
      const b = make_message({ chat_id: "ch2" });
      expect(policy.key("telegram", a)).not.toBe(policy.key("telegram", b));
    });

    it("다른 provider → 다른 키", () => {
      const msg = make_message();
      expect(policy.key("telegram", msg)).not.toBe(policy.key("slack", msg));
    });
  });

  describe("agent_reply 키 전략", () => {
    it("agent_reply + trigger → trigger 기반 키", () => {
      const msg = make_message({
        content: "response text",
        metadata: { kind: "agent_reply", trigger_message_id: "msg-123" },
      });
      const key = policy.key("telegram", msg);
      expect(key).toContain("agent_reply");
      expect(key).toContain("msg-123");
    });

    it("agent_error + trigger → trigger 기반 키", () => {
      const msg = make_message({
        content: "error occurred",
        metadata: { kind: "agent_error", trigger_message_id: "msg-456" },
      });
      const key = policy.key("telegram", msg);
      expect(key).toContain("agent_error");
      expect(key).toContain("msg-456");
    });

    it("같은 trigger의 agent_reply → 같은 키 (content 무관)", () => {
      const a = make_message({
        content: "response A",
        metadata: { kind: "agent_reply", trigger_message_id: "msg-1" },
      });
      const b = make_message({
        content: "response B",
        metadata: { kind: "agent_reply", trigger_message_id: "msg-1" },
      });
      expect(policy.key("telegram", a)).toBe(policy.key("telegram", b));
    });
  });

  describe("미디어 정규화", () => {
    it("미디어 포함 시 키에 반영", () => {
      const a = make_message({ content: "text" });
      const b = make_message({
        content: "text",
        media: [{ type: "image", url: "https://example.com/img.png" }],
      });
      expect(policy.key("telegram", a)).not.toBe(policy.key("telegram", b));
    });

    it("미디어 순서 무관 (정렬됨)", () => {
      const a = make_message({
        media: [
          { type: "image", url: "a.png" },
          { type: "file", url: "b.pdf" },
        ],
      });
      const b = make_message({
        media: [
          { type: "file", url: "b.pdf" },
          { type: "image", url: "a.png" },
        ],
      });
      expect(policy.key("telegram", a)).toBe(policy.key("telegram", b));
    });
  });

  describe("metadata 폴백", () => {
    it("metadata 없으면 에러 없이 키 생성", () => {
      const msg = make_message({ metadata: undefined });
      expect(() => policy.key("telegram", msg)).not.toThrow();
    });

    it("metadata가 비객체면 무시", () => {
      const msg = make_message({ metadata: "invalid" as unknown });
      expect(() => policy.key("telegram", msg)).not.toThrow();
    });

    it("source_message_id 폴백", () => {
      const msg = make_message({
        metadata: { kind: "agent_reply", source_message_id: "src-1" },
      });
      const key = policy.key("telegram", msg);
      expect(key).toContain("src-1");
    });

    it("request_id 폴백", () => {
      const msg = make_message({
        metadata: { kind: "agent_reply", request_id: "req-1" },
      });
      const key = policy.key("telegram", msg);
      expect(key).toContain("req-1");
    });
  });
});
