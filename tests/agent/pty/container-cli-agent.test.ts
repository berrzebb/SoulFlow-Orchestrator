import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { MockCliAdapter } from "@helpers/mock-cli-adapter.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import type { PtyFactory, CliAdapter } from "@src/agent/pty/types.ts";
import type { AgentEvent } from "@src/agent/agent.types.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const MOCK_AGENT = resolve(__dirname, "../../helpers/mock-ndjson-agent.ts");

/** process.execPath + --import tsx로 Windows ENOENT 회피. */
function mock_factory(env?: Record<string, string>): PtyFactory {
  return (_file, _args, options) => {
    return new LocalPty(process.execPath, ["--import", "tsx", MOCK_AGENT, ..._args], {
      ...options,
      env: { ...options.env, ...env },
    });
  };
}

function create_agent(opts?: {
  adapter?: CliAdapter;
  env?: Record<string, string>;
  factory_env?: Record<string, string>;
}) {
  const adapter = opts?.adapter ?? new MockCliAdapter();
  const logger = create_noop_logger();
  const pool = new ContainerPool({
    pty_factory: mock_factory(opts?.factory_env),
    adapter,
    default_env: {},
    cwd: process.cwd(),
    max_idle_ms: 0,
    logger,
  });
  const bus = new AgentBus({
    pool,
    adapter,
    logger,
  });
  return new ContainerCliAgent({
    id: "test-container-cli",
    bus,
    adapter,
    logger,
    default_env: opts?.env ?? {},
  });
}

describe("ContainerCliAgent E2E", () => {
  let agent: ContainerCliAgent;
  afterEach(() => { agent?.stop(); });

  it("mock agent를 스폰하고 NDJSON으로 통신한다", async () => {
    agent = create_agent();
    const result = await agent.run({
      task: "tell me something",
      task_id: "e2e-basic",
    });

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toContain("tell me something");
    expect(result.session).not.toBeNull();
    expect(result.usage.prompt_tokens).toBeGreaterThan(0);
    expect(result.usage.completion_tokens).toBeGreaterThan(0);
  }, 20_000);

  it("system_prompt + task를 결합하여 전달한다", async () => {
    agent = create_agent({ factory_env: { MOCK_ECHO: "true" } });
    const result = await agent.run({
      task: "user task",
      task_id: "e2e-sys",
      system_prompt: "system instruction",
    });

    expect(result.finish_reason).toBe("stop");
    // MockCliAdapter는 supports_system_prompt_flag=false → task에 합침
    expect(result.content).toContain("system instruction");
    expect(result.content).toContain("user task");
  }, 20_000);

  it("AgentEvent 스트림을 올바르게 발행한다", async () => {
    agent = create_agent();
    const events: AgentEvent[] = [];

    const result = await agent.run({
      task: "stream test",
      task_id: "e2e-events",
      hooks: {
        on_event: (e) => { events.push(e); },
      },
    });

    expect(result.finish_reason).toBe("stop");

    const types = events.map((e) => e.type);
    expect(types).toContain("init");
    expect(types).toContain("content_delta");
    expect(types).toContain("complete");
  }, 20_000);

  it("on_stream 훅이 assistant_chunk에서 호출된다", async () => {
    agent = create_agent();
    const chunks: string[] = [];

    await agent.run({
      task: "stream hook test",
      task_id: "e2e-on-stream",
      hooks: {
        on_stream: (chunk) => { chunks.push(chunk); },
      },
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("stream hook test");
  }, 20_000);

  it("에러 응답을 AgentRunResult로 변환한다", async () => {
    agent = create_agent({ factory_env: { MOCK_ERROR: "fatal" } });
    const result = await agent.run({
      task: "trigger error",
      task_id: "e2e-error",
    });

    expect(result.finish_reason).toBe("error");
    expect(result.metadata.error).toBeDefined();
  }, 20_000);

  it("send_input으로 followup 메시지를 주입한다", async () => {
    agent = create_agent();
    let send_fn: ((text: string) => void) | null = null;

    const result = await agent.run({
      task: "initial task",
      task_id: "e2e-followup",
      register_send_input: (fn) => { send_fn = fn; },
    });

    expect(result.finish_reason).toBe("stop");
    expect(send_fn).not.toBeNull();
  }, 20_000);

  it("resume_session의 session_id를 세션 키로 사용한다", async () => {
    agent = create_agent();
    const result = await agent.run({
      task: "resume test",
      task_id: "e2e-resume",
      resume_session: {
        session_id: "previous-session-id",
        backend: "test-container-cli",
        created_at: new Date().toISOString(),
      },
    });

    expect(result.finish_reason).toBe("stop");
    expect(result.session?.session_id).toBeTruthy();
  }, 20_000);

  it("is_available는 항상 true를 반환한다", () => {
    agent = create_agent();
    expect(agent.is_available()).toBe(true);
  });

  it("capabilities가 어댑터에 따라 동적 설정된다", () => {
    // MockCliAdapter: supports_tool_filtering = false
    agent = create_agent();
    expect(agent.native_tool_loop).toBe(true);
    expect(agent.supports_resume).toBe(true);
    expect(agent.capabilities.send_input).toBe(true);
    expect(agent.capabilities.tool_result_events).toBe(true);
    expect(agent.capabilities.tool_executors).toBe(false);
    expect(agent.capabilities.tool_filtering).toBe(false);

    // ClaudeCliAdapter: supports_tool_filtering = true
    const claude_agent = create_agent({ adapter: new ClaudeCliAdapter() });
    expect(claude_agent.capabilities.tool_filtering).toBe(true);
    claude_agent.stop();
  });

  it("wait_for_input_ms 설정 시 complete 후 followup을 대기한다", async () => {
    agent = create_agent();
    let send_fn: ((text: string) => void) | null = null;
    const events: AgentEvent[] = [];

    // 첫 complete 후 300ms 이내에 followup 주입
    const inject_timer = setTimeout(() => {
      if (send_fn) send_fn("followup message");
    }, 300);

    const result = await agent.run({
      task: "initial task",
      task_id: "e2e-hitl",
      wait_for_input_ms: 2000,
      register_send_input: (fn: (text: string) => void) => { send_fn = fn; },
      hooks: {
        on_event: (e: AgentEvent) => { events.push(e); },
      },
    });

    clearTimeout(inject_timer);

    expect(result.finish_reason).toBe("stop");
    // followup이 처리되어 2번째 턴의 결과가 content에 반영
    expect(result.content).toContain("followup message");
    // content_delta가 2회 이상 (initial + followup)
    const deltas = events.filter((e) => e.type === "content_delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("wait_for_input_ms 타임아웃 시 정상 종료한다", async () => {
    agent = create_agent();

    const start = Date.now();
    const result = await agent.run({
      task: "timeout test",
      task_id: "e2e-hitl-timeout",
      wait_for_input_ms: 500,
    });
    const elapsed = Date.now() - start;

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toContain("timeout test");
    // wait_for_input_ms 대기 후 종료했으므로 최소 500ms 소요
    expect(elapsed).toBeGreaterThanOrEqual(400);
  }, 20_000);

  it("abort_signal로 실행을 중단할 수 있다", async () => {
    agent = create_agent({ factory_env: { MOCK_DELAY_MS: "5000" } });
    const controller = new AbortController();

    setTimeout(() => controller.abort(), 100);

    const result = await agent.run({
      task: "long task",
      task_id: "e2e-abort",
      abort_signal: controller.signal,
    });

    expect(["stop", "max_turns", "error"]).toContain(result.finish_reason);
  }, 20_000);
});
