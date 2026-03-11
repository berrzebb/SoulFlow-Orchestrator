/**
 * AgentBus — 미커버 분기 (cov3):
 * - L94: ask() on_output 콜백에서 key/type 불일치 → early return
 */
import { describe, it, expect, vi } from "vitest";
import { AgentBus } from "@src/agent/pty/agent-bus.js";
import type { AgentTransport, AgentOutputMessage } from "@src/agent/pty/types.js";
import { create_noop_logger } from "@helpers/harness.js";

function make_mock_transport(sessions: string[] = ["agent-1"]) {
  const handlers: Array<(key: string, msg: AgentOutputMessage) => void> = [];
  const t = {
    send: vi.fn(),
    on_output(handler: (key: string, msg: AgentOutputMessage) => void) {
      handlers.push(handler);
      return { dispose: () => { handlers.splice(handlers.indexOf(handler), 1); } };
    },
    list_sessions: () => sessions,
    shutdown: vi.fn().mockResolvedValue(undefined),
    emit: (key: string, msg: AgentOutputMessage) => handlers.forEach((h) => h(key, msg)),
  } as unknown as AgentTransport & { emit: (k: string, m: AgentOutputMessage) => void };
  return t;
}

// ── L94: 불일치 메시지 → early return ────────────────────────────────────────

describe("AgentBus — L94: on_output 불일치 메시지 → early return", () => {
  it("다른 key 메시지 emit → L94 early return, 매칭 메시지 후 resolve", async () => {
    const transport = make_mock_transport(["agent-1"]);
    const bus = new AgentBus({
      pool: {} as any,
      adapter: {} as any,
      logger: create_noop_logger(),
      transport,
    });

    const ask_promise = bus.ask({ from: "req", to: "agent-1", content: "ping" });

    // 다른 key → L94 early return (key !== opts.to)
    transport.emit("other-agent", { type: "complete", result: "ignored", usage: { input_tokens: 0, output_tokens: 0 } });

    // 올바른 key지만 non-complete type → L94 early return (msg.type !== "complete")
    transport.emit("agent-1", { type: "stream", content: "partial", usage: { input_tokens: 0, output_tokens: 0 } } as any);

    // 최종 complete 메시지 → resolve
    transport.emit("agent-1", { type: "complete", result: "pong", usage: { input_tokens: 1, output_tokens: 1 } });

    const result = await ask_promise;
    expect(result).toBe("pong");
  });
});
