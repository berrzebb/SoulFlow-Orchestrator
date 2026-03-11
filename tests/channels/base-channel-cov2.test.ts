/**
 * base.ts — 미커버 분기 보충:
 * - L161: parse_agent_mentions — seen.has(key) → continue (plain 중복 멘션)
 */
import { describe, it, expect } from "vitest";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.js";
import { BaseChannel } from "@src/channels/base.js";

class StubChannel extends BaseChannel {
  constructor() { super("slack", "stub"); }
  async start(): Promise<void> { /* no-op */ }
  async stop(): Promise<void> { /* no-op */ }
  async send(_msg: OutboundMessage): Promise<{ ok: boolean }> { return { ok: true }; }
  async read(_chat_id: string): Promise<InboundMessage[]> { return []; }
  protected async set_typing_remote(): Promise<void> { /* no-op */ }
}

describe("BaseChannel.parse_agent_mentions — L161: seen 중복 → continue", () => {
  it("같은 alias가 <@alice>와 @alice 둘 다 등장 → L161 continue (중복 제거)", () => {
    const channel = new StubChannel();
    // <@alice>는 Slack 포맷으로 먼저 seen에 추가됨
    // @alice는 plain 매칭에서 seen.has("alice") → L161 continue
    const mentions = channel.parse_agent_mentions("<@alice> hello @alice");
    // alice가 한 번만 나타나야 함 (중복 제거)
    expect(mentions).toHaveLength(1);
    expect(mentions[0].alias).toBe("alice");
  });

  it("두 개의 다른 plain @mentions → 각각 추가됨", () => {
    const channel = new StubChannel();
    const mentions = channel.parse_agent_mentions("@alice and @bob");
    expect(mentions).toHaveLength(2);
  });
});
