/**
 * bus factory — memory 분기 + redact_url 테스트.
 */
import { describe, it, expect } from "vitest";
import { create_message_bus, type BusFactoryConfig } from "../../src/bus/factory.js";

describe("create_message_bus", () => {
  it("backend=memory → InMemoryMessageBus 반환", async () => {
    const bus = await create_message_bus({ backend: "memory" });
    expect(bus.kind).toBe("memory");
    expect(bus.is_closed()).toBe(false);
    await bus.close();
  });

  it("backend=redis, url 없음 → memory 폴백", async () => {
    const bus = await create_message_bus({ backend: "redis" });
    expect(bus.kind).toBe("memory");
    await bus.close();
  });

  it("backend=redis, url 빈 문자열 → memory 폴백", async () => {
    const bus = await create_message_bus({ backend: "redis", redis: { url: "" } });
    expect(bus.kind).toBe("memory");
    await bus.close();
  });
});
