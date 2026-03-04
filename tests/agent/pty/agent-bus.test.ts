import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { MockCliAdapter } from "@helpers/mock-cli-adapter.ts";
import type { PtyFactory } from "@src/agent/pty/types.ts";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const MOCK_AGENT = resolve(__dirname, "../../helpers/mock-ndjson-agent.ts");

/** mock agent를 tsx로 실행하는 PtyFactory. process.execPath로 Windows ENOENT 회피. */
const mock_factory: PtyFactory = (_file, _args, options) => {
  return new LocalPty(process.execPath, ["--import", "tsx", MOCK_AGENT, ..._args], {
    ...options,
    env: { ...options.env },
  });
};

function create_bus(opts?: { factory?: PtyFactory; env?: Record<string, string> }) {
  const adapter = new MockCliAdapter();
  const logger = create_noop_logger();
  const pool = new ContainerPool({
    pty_factory: opts?.factory ?? mock_factory,
    adapter,
    default_env: opts?.env ?? {},
    cwd: process.cwd(),
    max_idle_ms: 0,
    logger,
  });
  return new AgentBus({ pool, adapter, logger });
}

describe("AgentBus", () => {
  let bus: AgentBus;
  afterEach(async () => { await bus?.shutdown(); });

  it("send_and_wait으로 mock agent에게 메시지를 보내고 응답을 받는다", async () => {
    bus = create_bus();
    const result = await bus.send_and_wait("session-1", "hello world", { session_key: "session-1" });

    expect(result.type).toBe("complete");
    if (result.type === "complete") {
      expect(result.result).toContain("hello world");
      expect(result.usage).toBeDefined();
    }
  }, 15_000);

  it("출력 이벤트를 스트리밍으로 수신한다", async () => {
    bus = create_bus();
    const events: string[] = [];

    bus.on_output((key, msg) => {
      events.push(`${key}:${msg.type}`);
    });

    await bus.send_and_wait("stream-test", "test message", { session_key: "stream-test" });

    expect(events).toContain("stream-test:assistant_chunk");
    expect(events).toContain("stream-test:complete");
  }, 15_000);

  it("여러 세션을 독립적으로 관리한다", async () => {
    bus = create_bus();

    const [r1, r2] = await Promise.all([
      bus.send_and_wait("s1", "msg-for-s1", { session_key: "s1" }),
      bus.send_and_wait("s2", "msg-for-s2", { session_key: "s2" }),
    ]);

    expect(r1.type).toBe("complete");
    expect(r2.type).toBe("complete");
    if (r1.type === "complete") expect(r1.result).toContain("msg-for-s1");
    if (r2.type === "complete") expect(r2.result).toContain("msg-for-s2");
  }, 15_000);

  it("같은 세션에 연속 메시지를 보낼 수 있다", async () => {
    bus = create_bus();

    const r1 = await bus.send_and_wait("multi", "first", { session_key: "multi" });
    expect(r1.type).toBe("complete");

    const r2 = await bus.send_and_wait("multi", "second", { session_key: "multi" });
    expect(r2.type).toBe("complete");
    if (r2.type === "complete") expect(r2.result).toContain("second");
  }, 15_000);

  it("followup 메시지를 큐잉한다", () => {
    bus = create_bus();
    bus.queue_followup("s1", "followup-1");
    bus.queue_followup("s1", "followup-2");

    const drained = bus.lane_queue.drain_followups("s1");
    expect(drained).toEqual(["followup-1", "followup-2"]);
  });

  it("remove_session으로 세션을 정리한다", async () => {
    bus = create_bus();
    await bus.send_and_wait("cleanup-test", "hello", { session_key: "cleanup-test" });
    await bus.remove_session("cleanup-test");
    // 제거 후에도 새 세션으로 재사용 가능
    const result = await bus.send_and_wait("cleanup-test", "hello again", { session_key: "cleanup-test" });
    expect(result.type).toBe("complete");
  }, 15_000);

  it("에러 응답을 올바르게 전달한다", async () => {
    bus = create_bus({ env: { MOCK_ERROR: "auth" } });
    const result = await bus.send_and_wait("err-test", "trigger error", { session_key: "err-test" });

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("auth");
    }
  }, 15_000);
});
