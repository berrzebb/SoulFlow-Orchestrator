import { describe, it, expect } from "vitest";
import { MessageBus } from "@src/bus/service.ts";
import type { ProgressEvent } from "@src/bus/types.ts";

describe("Task Progress via MessageBus", () => {
  it("publish_progress → consume_progress 라운드트립", async () => {
    const bus = new MessageBus();
    const event: ProgressEvent = {
      task_id: "task-1",
      step: 1,
      total_steps: 5,
      description: "데이터 수집 중",
      provider: "telegram",
      chat_id: "chat-123",
      at: new Date().toISOString(),
    };

    await bus.publish_progress(event);
    const received = await bus.consume_progress({ timeout_ms: 1000 });

    expect(received).not.toBeNull();
    expect(received!.task_id).toBe("task-1");
    expect(received!.step).toBe(1);
    expect(received!.description).toBe("데이터 수집 중");
  });

  it("progress 없으면 timeout 후 null", async () => {
    const bus = new MessageBus();
    const received = await bus.consume_progress({ timeout_ms: 50 });
    expect(received).toBeNull();
  });

  it("close 후 publish_progress 무시", async () => {
    const bus = new MessageBus();
    await bus.close();

    await bus.publish_progress({
      task_id: "task-2",
      step: 1,
      description: "should be ignored",
      provider: "slack",
      chat_id: "c",
      at: new Date().toISOString(),
    });

    const received = await bus.consume_progress({ timeout_ms: 50 });
    expect(received).toBeNull();
  });

  it("여러 progress 이벤트 순서대로 소비", async () => {
    const bus = new MessageBus();

    for (let i = 1; i <= 3; i++) {
      await bus.publish_progress({
        task_id: "task-3",
        step: i,
        total_steps: 3,
        description: `step ${i}`,
        provider: "telegram",
        chat_id: "chat-456",
        at: new Date().toISOString(),
      });
    }

    const e1 = await bus.consume_progress({ timeout_ms: 100 });
    const e2 = await bus.consume_progress({ timeout_ms: 100 });
    const e3 = await bus.consume_progress({ timeout_ms: 100 });

    expect(e1!.step).toBe(1);
    expect(e2!.step).toBe(2);
    expect(e3!.step).toBe(3);
  });

  it("waiter가 대기 중일 때 publish → 즉시 전달", async () => {
    const bus = new MessageBus();

    const consume_promise = bus.consume_progress({ timeout_ms: 5000 });

    // 약간의 딜레이 후 publish
    await new Promise((r) => setTimeout(r, 10));
    await bus.publish_progress({
      task_id: "task-4",
      step: 1,
      description: "immediate delivery",
      provider: "discord",
      chat_id: "ch",
      at: new Date().toISOString(),
    });

    const received = await consume_promise;
    expect(received).not.toBeNull();
    expect(received!.description).toBe("immediate delivery");
  });
});
