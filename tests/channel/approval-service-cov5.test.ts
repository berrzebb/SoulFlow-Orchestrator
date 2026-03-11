/**
 * ApprovalService — 미커버 분기 (cov5):
 * - L109: apply_decision() → !this.runtime → return { handled: false }
 *
 * apply_decision은 private 메서드이므로 as-any로 직접 호출.
 * runtime=null인 생성자로 인스턴스 생성 → L109 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { ApprovalService } from "@src/channels/approval.service.js";
import type { InboundMessage, OutboundMessage } from "@src/bus/types.js";

function make_inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    chat_id: "ch-1",
    content: "yes",
    at: new Date().toISOString(),
    ...overrides,
  } as InboundMessage;
}

function make_service_no_runtime(): ApprovalService {
  return new ApprovalService({
    agent_runtime: null,
    send_reply: vi.fn().mockResolvedValue({ ok: true }),
    resolve_reply_to: vi.fn().mockReturnValue("reply-to"),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  });
}

// ── L109: apply_decision → !this.runtime → { handled: false } ────────────────

describe("ApprovalService — L109: apply_decision with null runtime", () => {
  it("runtime=null 직접 apply_decision 호출 → L109: { handled: false } 반환", async () => {
    const svc = make_service_no_runtime();

    // private 메서드를 직접 호출해 L109 커버
    const result = await (svc as any).apply_decision(
      "slack",
      make_inbound(),
      "req-id-001",
      "yes",
      "text",
    );

    expect(result).toEqual({ handled: false });
  });

  it("source='reaction'으로도 동일하게 { handled: false } 반환 (L109)", async () => {
    const svc = make_service_no_runtime();

    const result = await (svc as any).apply_decision(
      "telegram",
      make_inbound({ chat_id: "tg-chat" }),
      "req-id-002",
      "✅",
      "reaction",
    );

    expect(result).toEqual({ handled: false });
  });
});
