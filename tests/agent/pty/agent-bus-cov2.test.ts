/**
 * AgentBus — 미커버 분기 (cov2):
 * - L94: ask() → on_output 콜백에서 complete 메시지 수신 → resolve(msg.result)
 */
import { describe, it, expect, vi } from "vitest";
import { AgentBus } from "@src/agent/pty/agent-bus.js";
import type { AgentTransport, AgentOutputMessage, Disposable } from "@src/agent/pty/types.js";
import { create_noop_logger } from "@helpers/harness.js";

function make_mock_transport(sessions: string[] = ["agent-1"]): AgentTransport {
  const handlers: Array<(key: string, msg: AgentOutputMessage) => void> = [];
  return {
    send: vi.fn(),
    on_output(handler) {
      handlers.push(handler);
      return { dispose: () => { handlers.splice(handlers.indexOf(handler), 1); } };
    },
    list_sessions: () => sessions,
    shutdown: vi.fn().mockResolvedValue(undefined),
    emit: (key: string, msg: AgentOutputMessage) => handlers.forEach((h) => h(key, msg)),
  } as unknown as AgentTransport & { emit: (key: string, msg: AgentOutputMessage) => void };
}

// ── L94: ask() → resolve(msg.result) ─────────────────────────────────────────

describe("AgentBus — L94: ask() complete 수신 → resolve", () => {
  it("ask() → on_output complete 메시지 수신 → resolve(msg.result) (L94)", async () => {
    const transport = make_mock_transport(["agent-1"]);
    const bus = new AgentBus({
      pool: {} as any,
      adapter: {} as any,
      logger: create_noop_logger(),
      transport,
    });

    // ask()를 실행하고 즉시 complete 메시지를 emit
    const ask_promise = bus.ask({
      from: "requester",
      to: "agent-1",
      content: "ping",
    });

    // on_output 핸들러가 등록된 후 complete 메시지 발송
    const t = transport as unknown as { emit: (k: string, m: AgentOutputMessage) => void };
    t.emit("agent-1", { type: "complete", result: "pong response", usage: { input_tokens: 1, output_tokens: 1 } });

    const result = await ask_promise;
    expect(result).toBe("pong response");
  });
});
