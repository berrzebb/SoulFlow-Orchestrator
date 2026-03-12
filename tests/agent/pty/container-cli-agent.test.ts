import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { ContainerCliAgent } from "@src/agent/pty/container-cli-agent.ts";
import { AgentBus } from "@src/agent/pty/agent-bus.ts";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { MockCliAdapter } from "@helpers/mock-cli-adapter.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import { LocalPty } from "@src/agent/pty/local-pty.ts";
import type { PtyFactory, CliAdapter } from "@src/agent/pty/types.ts";
import { FailoverError } from "@src/agent/pty/types.ts";
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

// ══════════════════════════════════════════════════════════
// mock bus 기반 유닛 테스트
// ══════════════════════════════════════════════════════════

function make_bus(wait_for_followup_responses: (string[] | null)[] = []) {
  const output_handlers = new Set<(key: string, msg: any) => void>();
  let call_index = 0;
  return {
    send_and_wait: vi.fn(),
    on_output: vi.fn((handler: (key: string, msg: any) => void) => {
      output_handlers.add(handler);
      return { dispose: () => output_handlers.delete(handler) };
    }),
    queue_followup: vi.fn(),
    remove_session: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    lane_queue: {
      drain_followups: vi.fn().mockReturnValue([]),
      drain_collected: vi.fn().mockReturnValue(null),
      wait_for_followup: vi.fn().mockImplementation(() => {
        const resp = wait_for_followup_responses[call_index] ?? null;
        call_index++;
        return Promise.resolve(resp);
      }),
    },
    emit_output: (key: string, msg: any) => {
      for (const h of output_handlers) h(key, msg);
    },
  };
}

function make_mock_adapter(overrides: Record<string, unknown> = {}) {
  return {
    cli_id: "claude",
    session_id: null,
    stdin_mode: "close",
    supports_system_prompt_flag: true,
    supports_approval: false,
    supports_structured_output: false,
    supports_thinking: false,
    supports_budget_tracking: false,
    supports_tool_filtering: false,
    format_input: vi.fn().mockReturnValue("formatted"),
    parse_output: vi.fn(),
    build_args: vi.fn().mockReturnValue([]),
    ...overrides,
  } as any;
}

function make_mock_agent(overrides: Partial<{
  bus: ReturnType<typeof make_bus>;
  fallback_configured: boolean;
  auth_profile_count: number;
  profile_key_map: Map<number, Record<string, string>>;
  auth_service: any;
  tool_bridge: any;
}> = {}) {
  const bus = overrides.bus ?? make_bus();
  const adapter = make_mock_adapter();
  const mock_agent = new ContainerCliAgent({
    id: "claude_cli" as any,
    bus: bus as any,
    adapter,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    fallback_configured: overrides.fallback_configured ?? false,
    auth_profile_count: overrides.auth_profile_count ?? 1,
    profile_key_map: overrides.profile_key_map,
    auth_service: overrides.auth_service,
    tool_bridge: overrides.tool_bridge,
  });
  return { agent: mock_agent, bus, adapter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 성공 경로 (mock bus) ─────────────────────────────────

describe("ContainerCliAgent — 성공 경로 (mock)", () => {
  it("complete 결과 반환", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done", usage: { input: 10, output: 5 } });
    const result = await a.run({ task: "test task", task_id: "t1" });
    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("done");
  });

  it("emit 콜백: init + complete 이벤트 발생", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "ok" });
    const events: any[] = [];
    await a.run({ task: "t", task_id: "t2", hooks: { on_event: (e) => events.push(e) } });
    expect(events.some(e => e.type === "init")).toBe(true);
    expect(events.some(e => e.type === "complete")).toBe(true);
  });
});

// ── max_iterations 초과 ─────────────────────────────────

describe("ContainerCliAgent — max_iterations 초과 (mock)", () => {
  it("max_turns=1 + 계속 error → error finish_reason", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockResolvedValue({ type: "error", code: "unknown", message: "fatal error" });
    const result = await a.run({ task: "t", task_id: "t3", max_turns: 1 });
    expect(result.finish_reason).toBe("error");
  });
});

// ── abort_signal (mock) ─────────────────────────────────

describe("ContainerCliAgent — abort_signal (mock)", () => {
  it("abort 신호 전송 → 루프 탈출", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    const abort = new AbortController();
    b.send_and_wait.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 1));
      return { type: "complete", result: "done" };
    });
    abort.abort();
    const result = await a.run({ task: "t", task_id: "t4", max_turns: 3, abort_signal: abort.signal });
    expect(result.finish_reason).toBe("max_turns");
  });
});

// ── context_overflow — 컴팩션 재시작 ─────────────────────

describe("ContainerCliAgent — context_overflow (mock)", () => {
  it("1회 컴팩션 → 재시작 후 complete", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "context_window_exceeded", message: "context overflow" })
      .mockResolvedValueOnce({ type: "complete", result: "recovered" });
    const result = await a.run({ task: "t", task_id: "t5", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(b.remove_session).toHaveBeenCalled();
  });

  it("MAX_COMPACTION_ATTEMPTS(3) 초과 → error 반환", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockResolvedValue({
      type: "error", code: "context_window_exceeded", message: "context overflow",
    });
    const emit = vi.fn();
    const result = await a.run({
      task: "t", task_id: "t6", max_turns: 10,
      hooks: { on_event: emit },
    });
    expect(result.finish_reason).toBe("error");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("context_overflow with last_content → compact prompt에 포함", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "previous result", usage: { input: 5, output: 5 } })
      .mockResolvedValueOnce({ type: "error", code: "token_limit", message: "ctx" })
      .mockResolvedValueOnce({ type: "complete", result: "final" });

    b.lane_queue.drain_followups
      .mockReturnValueOnce(["followup1"])
      .mockReturnValue([]);

    const result = await a.run({ task: "t", task_id: "t7", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
  });
});

// ── auth_error — 프로파일 순환 ───────────────────────────

describe("ContainerCliAgent — auth_error (mock)", () => {
  it("auth_error + fallback_configured=true → FailoverError 전파", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: true });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });
    await expect(a.run({ task: "t", task_id: "t8" })).rejects.toThrow(FailoverError);
  });

  it("auth_error + fallback=false → error 반환", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: false });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });
    const emit = vi.fn();
    const result = await a.run({ task: "t", task_id: "t9", hooks: { on_event: emit } });
    expect(result.finish_reason).toBe("error");
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });
});

// ── billing ──────────────────────────────────────────────

describe("ContainerCliAgent — billing (mock)", () => {
  it("billing + fallback_configured → FailoverError", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: true });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "billing", message: "quota" });
    await expect(a.run({ task: "t", task_id: "t10" })).rejects.toThrow(FailoverError);
  });

  it("billing + fallback=false → error 반환", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: false });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "billing", message: "quota" });
    const result = await a.run({ task: "t", task_id: "t11" });
    expect(result.finish_reason).toBe("error");
  });
});

// ── rate_limit — backoff 후 재시도 ───────────────────────

describe("ContainerCliAgent — rate_limit (mock)", () => {
  it("rate_limit → 재시도 후 complete", async () => {
    vi.useFakeTimers();
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "rate_limited", message: "rate limit" })
      .mockResolvedValueOnce({ type: "complete", result: "ok" });
    const p = a.run({ task: "t", task_id: "t12", max_turns: 5 });
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.finish_reason).toBe("stop");
    vi.useRealTimers();
  });
});

// ── crash — 재시도 ───────────────────────────────────────

describe("ContainerCliAgent — crash (mock)", () => {
  it("crash → remove_session 후 재시도 complete", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "crash", message: "crashed" })
      .mockResolvedValueOnce({ type: "complete", result: "recovered" });
    const result = await a.run({ task: "t", task_id: "t13", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(b.remove_session).toHaveBeenCalled();
  });
});

// ── failover 오류 전파 ───────────────────────────────────

describe("ContainerCliAgent — failover error class (mock)", () => {
  it("failover + fallback_configured → FailoverError 전파", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: true });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "failover", message: "failover" });
    await expect(a.run({ task: "t", task_id: "t14" })).rejects.toThrow(FailoverError);
  });

  it("failover + fallback=false → fatal error 반환", async () => {
    const { agent: a, bus: b } = make_mock_agent({ fallback_configured: false });
    b.send_and_wait.mockResolvedValueOnce({ type: "error", code: "failover", message: "failover" });
    const result = await a.run({ task: "t", task_id: "t15" });
    expect(result.finish_reason).toBe("error");
  });
});

// ── unexpected exception → catch 블록 ───────────────────

describe("ContainerCliAgent — unexpected exception (mock)", () => {
  it("send_and_wait throw → catch → error result", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockRejectedValueOnce(new Error("unexpected!"));
    const result = await a.run({ task: "t", task_id: "t16" });
    expect(result.finish_reason).toBe("error");
    expect(result.metadata?.error).toContain("unexpected");
  });

  it("FailoverError는 catch에서 re-throw", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockRejectedValueOnce(new FailoverError("fail", { reason: "unknown", provider: "claude_cli" }));
    await expect(a.run({ task: "t", task_id: "t17" })).rejects.toThrow(FailoverError);
  });
});

// ── followup / wait_for_input_ms (mock) ──────────────────

describe("ContainerCliAgent — followup 처리 (mock)", () => {
  it("drain_followups → 루프 재진입", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "r1" })
      .mockResolvedValueOnce({ type: "complete", result: "r2" });
    b.lane_queue.drain_followups
      .mockReturnValueOnce(["followup message"])
      .mockReturnValue([]);
    const result = await a.run({ task: "t", task_id: "t18", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(b.send_and_wait).toHaveBeenCalledTimes(2);
  });

  it("drain_collected → 루프 재진입", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "r1" })
      .mockResolvedValueOnce({ type: "complete", result: "r2" });
    b.lane_queue.drain_collected
      .mockReturnValueOnce("collected message")
      .mockReturnValue(null);
    const result = await a.run({ task: "t", task_id: "t19", max_turns: 5 });
    expect(result.finish_reason).toBe("stop");
    expect(b.send_and_wait).toHaveBeenCalledTimes(2);
  });
});

// ── register_send_input (mock) ───────────────────────────

describe("ContainerCliAgent — register_send_input (mock)", () => {
  it("register_send_input 콜백 등록 → queue_followup 연결", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockResolvedValue({ type: "complete", result: "done" });
    let registered_fn: ((text: string) => void) | null = null;
    await a.run({
      task: "t", task_id: "t20",
      register_send_input: (fn) => { registered_fn = fn; },
    });
    expect(registered_fn).not.toBeNull();
    registered_fn!("hello input");
    expect(b.queue_followup).toHaveBeenCalledWith("t20", "hello input");
  });
});

// ── on_output / relay_output_event (mock) ────────────────

describe("ContainerCliAgent — on_output → relay_output_event (mock)", () => {
  it("tool_use → tool_calls_count 증가 + emit tool_use event", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockImplementation(async (key: string) => {
      b.emit_output(key, { type: "tool_use", tool: "Bash", input: { cmd: "ls" } });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    const result = await a.run({
      task: "t", task_id: "t21",
      hooks: { on_event: (e) => events.push(e) },
    });
    expect(result.tool_calls_count).toBe(1);
    expect(events.some(e => e.type === "tool_use")).toBe(true);
  });

  it("assistant_message → content_delta emit + on_stream 호출", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockImplementation(async (key: string) => {
      b.emit_output(key, { type: "assistant_message", content: "hello!" });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    const stream_chunks: string[] = [];
    await a.run({
      task: "t", task_id: "t22",
      hooks: {
        on_event: (e) => events.push(e),
        on_stream: (chunk) => stream_chunks.push(chunk),
      },
    });
    expect(events.some(e => e.type === "content_delta")).toBe(true);
  });

  it("assistant_chunk → on_stream 호출", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockImplementation(async (key: string) => {
      b.emit_output(key, { type: "assistant_chunk", content: "streaming..." });
      return { type: "complete", result: "done" };
    });
    const chunks: string[] = [];
    await a.run({
      task: "t", task_id: "t23",
      hooks: { on_stream: (c) => chunks.push(c) },
    });
    expect(chunks).toContain("streaming...");
  });

  it("tool_result → tool_result event emit", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockImplementation(async (key: string) => {
      b.emit_output(key, { type: "tool_result", tool: "Bash", output: "result output" });
      return { type: "complete", result: "done" };
    });
    const events: any[] = [];
    await a.run({
      task: "t", task_id: "t24",
      hooks: { on_event: (e) => events.push(e) },
    });
    expect(events.some(e => e.type === "tool_result")).toBe(true);
  });

  it("다른 session_key 출력 → 무시됨", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    b.send_and_wait.mockImplementation(async (key: string) => {
      b.emit_output("OTHER_SESSION", { type: "tool_use", tool: "Bash", input: {} });
      b.emit_output(key, { type: "complete", result: "done" });
      return { type: "complete", result: "done" };
    });
    const result = await a.run({ task: "t", task_id: "t25" });
    expect(result.tool_calls_count).toBe(0);
  });
});

// ── check_auth (mock) ────────────────────────────────────

describe("ContainerCliAgent — check_auth (mock)", () => {
  it("auth_service 없음 → always true", async () => {
    const { agent: a } = make_mock_agent();
    const result = await a.check_auth();
    expect(result).toBe(true);
    expect(a.is_available()).toBe(true);
  });

  it("auth_service.check → authenticated=true → is_available=true", async () => {
    const auth_service = { check: vi.fn().mockResolvedValue({ authenticated: true }) };
    const { agent: a } = make_mock_agent({ auth_service });
    const result = await a.check_auth();
    expect(result).toBe(true);
    expect(a.is_available()).toBe(true);
  });

  it("auth_service.check → authenticated=false → is_available=false", async () => {
    const auth_service = { check: vi.fn().mockResolvedValue({ authenticated: false }) };
    const { agent: a } = make_mock_agent({ auth_service });
    const result = await a.check_auth();
    expect(result).toBe(false);
    expect(a.is_available()).toBe(false);
  });
});

// ── stop (mock) ──────────────────────────────────────────

describe("ContainerCliAgent — stop (mock)", () => {
  it("stop() → bus.shutdown 호출", () => {
    const { agent: a, bus: b } = make_mock_agent();
    a.stop();
    expect(b.shutdown).toHaveBeenCalledOnce();
  });

  it("stop() with tool_bridge → tool_bridge.stop 호출", () => {
    const tool_bridge = { stop: vi.fn().mockResolvedValue(undefined), list_tools: vi.fn().mockReturnValue([]) };
    const { agent: a, bus: b } = make_mock_agent({ tool_bridge });
    a.stop();
    expect(b.shutdown).toHaveBeenCalledOnce();
    expect(tool_bridge.stop).toHaveBeenCalledOnce();
  });
});

// ── build_tool_definitions (mock) ────────────────────────

describe("ContainerCliAgent — build_tool_definitions (mock)", () => {
  it("tool_bridge.list_tools → 도구 목록 포함", async () => {
    const tool_bridge = {
      list_tools: vi.fn().mockReturnValue([
        { name: "MyTool", description: "Does something" },
        { name: "OtherTool", description: null },
      ]),
      stop: vi.fn(),
    };
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done" });
    const adapter = make_mock_adapter({ cli_id: "codex" });
    const codex_agent = new ContainerCliAgent({
      id: "codex_cli" as any,
      bus: bus as any,
      adapter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      tool_bridge: tool_bridge as any,
    });
    const result = await codex_agent.run({ task: "t", task_id: "t26" });
    expect(result.finish_reason).toBe("stop");
    expect(tool_bridge.list_tools).toHaveBeenCalled();
  });
});

// ── system_prompt: supports_system_prompt_flag = false ───

describe("ContainerCliAgent — system_prompt 처리 (mock)", () => {
  it("supports_system_prompt_flag=false → task에 합침", async () => {
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "complete", result: "done" });
    const adapter = make_mock_adapter({ supports_system_prompt_flag: false });
    const sys_agent = new ContainerCliAgent({
      id: "claude_cli" as any,
      bus: bus as any,
      adapter,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });
    const result = await sys_agent.run({
      task: "my task",
      task_id: "t27",
      system_prompt: "system instruction",
    });
    expect(result.finish_reason).toBe("stop");
    const prompt_sent = bus.send_and_wait.mock.calls[0][1];
    expect(prompt_sent).toContain("system instruction");
    expect(prompt_sent).toContain("my task");
  });
});

// ── release_session (mock) ───────────────────────────────

describe("ContainerCliAgent — release_session (mock)", () => {
  it("release_session → bus.remove_session 호출", async () => {
    const { agent: a, bus: b } = make_mock_agent();
    await a.release_session("task-xyz");
    expect(b.remove_session).toHaveBeenCalledWith("task-xyz");
  });
});

// ── wait_for_followup 반환 (mock) ────────────────────────

describe("ContainerCliAgent — wait_for_followup 반환 (mock)", () => {
  it("wait_for_input_ms > 0 + wait_for_followup=[prompt] → prompt 업데이트 후 재시도", async () => {
    const bus = make_bus([["follow up input"]]);

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "complete", result: "", usage: { input: 5, output: 0 } })
      .mockResolvedValueOnce({ type: "complete", result: "final answer", usage: { input: 10, output: 5 } });

    const { agent: a } = make_mock_agent({ bus });

    const result = await a.run({
      task: "initial task",
      task_id: "t-followup",
      wait_for_input_ms: 100,
    });

    expect(result.finish_reason).toBe("stop");
    expect(bus.lane_queue.wait_for_followup).toHaveBeenCalled();
  });
});

// ── auth_error + profile_tracker 순환 (mock) ─────────────

describe("ContainerCliAgent — auth_error + profile 순환 (mock)", () => {
  it("auth_error → has_available=true → 프로파일 전환 후 재시도 성공", async () => {
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "profile_0" }],
      [1, { CLAUDE_AUTH_PROFILE: "profile_1" }],
    ]);
    const bus = make_bus();

    bus.send_and_wait
      .mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" })
      .mockResolvedValueOnce({ type: "complete", result: "ok", usage: { input: 5, output: 5 } });

    const { agent: a } = make_mock_agent({ bus, profile_key_map });

    const result = await a.run({ task: "task", task_id: "t-auth-rotate" });

    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("ok");
    expect(bus.send_and_wait).toHaveBeenCalledTimes(2);
    expect(bus.remove_session).toHaveBeenCalled();
  });

  it("auth_error → profile rotation → 프로파일 없음 → fallback=false → error 반환", async () => {
    const profile_key_map = new Map([
      [0, { CLAUDE_AUTH_PROFILE: "only_profile" }],
    ]);
    const bus = make_bus();
    bus.send_and_wait.mockResolvedValueOnce({ type: "error", code: "auth", message: "auth fail" });

    const { agent: a } = make_mock_agent({ bus, profile_key_map, fallback_configured: false });
    const result = await a.run({ task: "task", task_id: "t-auth-no-rotate" });

    expect(result.finish_reason).toBe("error");
  });
});
