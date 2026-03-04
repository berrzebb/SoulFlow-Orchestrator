import { describe, it, expect, vi } from "vitest";
import { AgentBus, type AskOptions } from "@src/agent/pty/agent-bus.ts";
import { CommPermissionGuard } from "@src/agent/pty/comm-permission.ts";
import type { AgentTransport, AgentOutputMessage, Disposable } from "@src/agent/pty/types.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { MockCliAdapter } from "@helpers/mock-cli-adapter.ts";
import { create_noop_logger } from "@helpers/harness.ts";

/** 테스트용 fake transport. send 호출 시 즉시 complete 응답. */
function create_fake_transport(sessions: string[] = []): AgentTransport & { handlers: Set<(k: string, m: AgentOutputMessage) => void> } {
  const handlers = new Set<(k: string, m: AgentOutputMessage) => void>();
  return {
    handlers,
    async send(_key, _msg) {
      const result: AgentOutputMessage = {
        type: "complete",
        result: "ok",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      return result;
    },
    on_output(handler) {
      handlers.add(handler);
      return { dispose: () => { handlers.delete(handler); } };
    },
    list_sessions: () => sessions,
    remove_session: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  };
}

function create_bus_with_transport(
  transport: AgentTransport,
  permission_guard?: CommPermissionGuard,
): AgentBus {
  const adapter = new MockCliAdapter();
  const logger = create_noop_logger();
  const pool = new ContainerPool({
    pty_factory: vi.fn() as any,
    adapter,
    default_env: {},
    cwd: process.cwd(),
    max_idle_ms: 0,
    logger,
  });
  return new AgentBus({ pool, adapter, logger, transport, permission_guard });
}

describe("AgentBus ask/broadcast", () => {
  it("ask: 대상 세션 미존재 시 에러", async () => {
    const transport = create_fake_transport(["a"]);
    const bus = create_bus_with_transport(transport);

    await expect(bus.ask({ from: "a", to: "nonexistent", content: "hi" }))
      .rejects.toThrow("target session not found");
  });

  it("ask: 타임아웃 시 에러", async () => {
    const transport = create_fake_transport(["a", "b"]);
    const bus = create_bus_with_transport(transport);

    await expect(bus.ask({ from: "a", to: "b", content: "hi", timeout_ms: 50 }))
      .rejects.toThrow("timeout");
  }, 5_000);

  it("ask: complete 이벤트 수신 시 응답 반환", async () => {
    const transport = create_fake_transport(["a", "b"]);
    const bus = create_bus_with_transport(transport);

    const promise = bus.ask({ from: "a", to: "b", content: "question", timeout_ms: 5_000 });

    // simulate complete from target
    setTimeout(() => {
      for (const h of transport.handlers) {
        h("b", { type: "complete", result: "answer-42", usage: { input_tokens: 1, output_tokens: 1 } });
      }
    }, 50);

    const result = await promise;
    expect(result).toBe("answer-42");
  });

  it("broadcast: 모든 세션에 followup 전달", () => {
    const transport = create_fake_transport(["s1", "s2", "s3"]);
    const bus = create_bus_with_transport(transport);

    bus.broadcast("alert", "system");

    const q1 = bus.lane_queue.drain_followups("s1");
    const q2 = bus.lane_queue.drain_followups("s2");
    const q3 = bus.lane_queue.drain_followups("s3");
    expect(q1).toEqual(["alert"]);
    expect(q2).toEqual(["alert"]);
    expect(q3).toEqual(["alert"]);
  });

  it("broadcast: 필터 적용", () => {
    const transport = create_fake_transport(["s1", "s2", "s3"]);
    const bus = create_bus_with_transport(transport);

    bus.broadcast("alert", "system", (key) => key !== "s2");

    expect(bus.lane_queue.drain_followups("s1")).toEqual(["alert"]);
    expect(bus.lane_queue.drain_followups("s2")).toEqual([]);
    expect(bus.lane_queue.drain_followups("s3")).toEqual(["alert"]);
  });

  it("list_sessions: transport 세션 목록 반환", () => {
    const transport = create_fake_transport(["x", "y"]);
    const bus = create_bus_with_transport(transport);
    expect(bus.list_sessions()).toEqual(["x", "y"]);
  });
});

describe("AgentBus + CommPermission", () => {
  it("ask: 권한 없으면 거부", async () => {
    const guard = new CommPermissionGuard(); // deny-all
    const transport = create_fake_transport(["a", "b"]);
    const bus = create_bus_with_transport(transport, guard);

    await expect(bus.ask({ from: "a", to: "b", content: "hi" }))
      .rejects.toThrow("comm denied");
  });

  it("ask: 권한 있으면 허용", async () => {
    const guard = new CommPermissionGuard([
      { from: "a", to: "b", allowed: true },
    ]);
    const transport = create_fake_transport(["a", "b"]);
    const bus = create_bus_with_transport(transport, guard);

    const promise = bus.ask({ from: "a", to: "b", content: "hi", timeout_ms: 5_000 });

    setTimeout(() => {
      for (const h of transport.handlers) {
        h("b", { type: "complete", result: "reply", usage: { input_tokens: 1, output_tokens: 1 } });
      }
    }, 50);

    await expect(promise).resolves.toBe("reply");
  });

  it("broadcast: 권한 없는 세션은 건너뜀", () => {
    const guard = new CommPermissionGuard([
      { from: "system", to: "s1", allowed: true },
      // s2는 규칙 없음 → deny
    ]);
    const transport = create_fake_transport(["s1", "s2"]);
    const bus = create_bus_with_transport(transport, guard);

    bus.broadcast("hello", "system");

    expect(bus.lane_queue.drain_followups("s1")).toEqual(["hello"]);
    expect(bus.lane_queue.drain_followups("s2")).toEqual([]);
  });
});
