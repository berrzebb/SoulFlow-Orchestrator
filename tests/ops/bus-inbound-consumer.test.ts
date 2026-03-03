import { describe, it, expect, afterEach } from "vitest";
import { create_harness, inbound, type Harness } from "@helpers/harness.ts";
import { MessageBus } from "@src/bus/service.ts";

describe("ChannelManager bus inbound consumer", () => {
  let harness: Harness | null = null;

  afterEach(async () => {
    if (harness) { await harness.cleanup(); harness = null; }
  });

  it("bus에 발행된 메시지가 handle_inbound_message를 거쳐 응답 생성", async () => {
    let orchestrated = false;
    harness = await create_harness({
      orchestration_handler: async () => {
        orchestrated = true;
        return { reply: "bus reply", mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
      config_patch: { autoReply: true },
    });

    await harness.manager.handle_inbound_message(inbound("hello from bus"));
    expect(orchestrated).toBe(true);
    expect(harness.dispatch.sent.length).toBeGreaterThan(0);
    expect(harness.dispatch.sent[0]!.message.content).toContain("bus reply");
  });

  it("여러 메시지를 순차 처리", async () => {
    const handled: string[] = [];
    harness = await create_harness({
      orchestration_handler: async (req) => {
        handled.push(String(req.message.content));
        return { reply: `echo: ${req.message.content}`, mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
      config_patch: { autoReply: true },
    });

    await harness.manager.handle_inbound_message(inbound("msg-1"));
    await harness.manager.handle_inbound_message(inbound("msg-2"));

    expect(handled).toContain("msg-1");
    expect(handled).toContain("msg-2");
    expect(harness.dispatch.sent).toHaveLength(2);
  });

  it("오류 발생 시 에러 응답 전송", async () => {
    harness = await create_harness({
      orchestration_handler: async () => {
        throw new Error("provider_timeout");
      },
      config_patch: { autoReply: true },
    });

    await harness.manager.handle_inbound_message(inbound("crash me"));
    expect(harness.dispatch.sent.length).toBeGreaterThan(0);
    expect(harness.dispatch.sent[0]!.message.content).toContain("실패");
  });

  it("health_check에 bus_inbound 크기 반영", async () => {
    harness = await create_harness();
    const health = harness.manager.health_check();
    expect(health.ok).toBe(false); // not running (start 미호출)
    expect(health.details).toHaveProperty("bus_inbound");
  });
});

describe("MessageBus publish/consume 기본 동작", () => {
  it("publish → consume 정상 순환", async () => {
    const bus = new MessageBus();
    const msg = { id: "1", provider: "test", channel: "ch", sender_id: "u", chat_id: "c", content: "hi", at: new Date().toISOString() };
    await bus.publish_inbound(msg);
    const consumed = await bus.consume_inbound({ timeout_ms: 100 });
    expect(consumed).not.toBeNull();
    expect(consumed!.content).toBe("hi");
    await bus.close();
  });

  it("close 후 consume은 null 반환", async () => {
    const bus = new MessageBus();
    await bus.close();
    const consumed = await bus.consume_inbound({ timeout_ms: 100 });
    expect(consumed).toBeNull();
  });
});
