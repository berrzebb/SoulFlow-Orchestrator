/**
 * bus/factory — create_message_bus 커버리지.
 */
import { describe, it, expect, vi } from "vitest";

// Redis bus mock (동적 import 대체)
vi.mock("@src/bus/redis-bus.js", () => ({
  RedisMessageBus: class MockRedisBus {
    readonly name = "redis";
  },
}));

import { create_message_bus } from "@src/bus/factory.js";
import { InMemoryMessageBus } from "@src/bus/service.js";

// ══════════════════════════════════════════
// memory backend
// ══════════════════════════════════════════

describe("create_message_bus — memory", () => {
  it("backend=memory → InMemoryMessageBus 반환", async () => {
    const bus = await create_message_bus({ backend: "memory" });
    expect(bus).toBeInstanceOf(InMemoryMessageBus);
  });

  it("redis URL 없이 backend=redis → memory 폴백", async () => {
    const bus = await create_message_bus({ backend: "redis" });
    expect(bus).toBeInstanceOf(InMemoryMessageBus);
  });
});

// ══════════════════════════════════════════
// redis backend
// ══════════════════════════════════════════

describe("create_message_bus — redis", () => {
  it("backend=redis + url → RedisMessageBus 반환", async () => {
    const bus = await create_message_bus({
      backend: "redis",
      redis: { url: "redis://localhost:6379" },
    });
    expect((bus as any).name).toBe("redis");
  });

  it("redis URL에 패스워드 → redact 처리 (로그만)", async () => {
    // redact_url이 내부 함수이므로 호출 성공 여부만 확인
    const bus = await create_message_bus({
      backend: "redis",
      redis: { url: "redis://:secret@localhost:6379" },
    });
    expect((bus as any).name).toBe("redis");
  });

  it("모든 redis 옵션 전달", async () => {
    const bus = await create_message_bus({
      backend: "redis",
      redis: {
        url: "redis://localhost:6379",
        keyPrefix: "test:",
        blockMs: 5000,
        claimIdleMs: 30000,
        streamMaxlen: { inbound: 1000, outbound: 1000, progress: 500 },
      },
    });
    expect((bus as any).name).toBe("redis");
  });

  it("잘못된 URL 형식(URL 파싱 불가) → redact_url catch → replace로 마스킹", async () => {
    // "not-a-valid-url://user:pass@host" — URL 파싱 실패 → catch → replace 경로 실행
    const bus = await create_message_bus({
      backend: "redis",
      redis: { url: "not-valid://user:pass@host:6379" },
    });
    expect((bus as any).name).toBe("redis");
  });
});
