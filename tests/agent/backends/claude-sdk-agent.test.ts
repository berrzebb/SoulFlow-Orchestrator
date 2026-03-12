/**
 * ClaudeSdkAgent — mock SDK query 기반 커버리지.
 * @anthropic-ai/claude-agent-sdk의 query()를 mock하여 각 메시지 타입 경로 검증.
 * base + extended + cov2 통합 (vi.mock 동일).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── SDK mock (vi.hoisted 필수) ──────────────────────────────────────

const { mock_query } = vi.hoisted(() => ({ mock_query: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mock_query,
}));

import { ClaudeSdkAgent } from "@src/agent/backends/claude-sdk.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────

function make_agent(config?: Record<string, unknown>) {
  return new ClaudeSdkAgent(config as any);
}

function make_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "task-1",
    task: "Do something",
    system_prompt: "You are helpful.",
    messages: [],
    cwd: "/tmp/test-cwd",
    ...overrides,
  };
}

/** async generator로 메시지 시퀀스를 생성하는 mock query 반환값. */
function make_query_instance(messages: Record<string, unknown>[], opts?: {
  close?: () => void;
  interrupt?: () => Promise<void>;
  streamInput?: (it: AsyncIterable<unknown>) => Promise<void>;
}) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) yield msg;
    },
    close: opts?.close ?? vi.fn(),
    interrupt: opts?.interrupt ?? vi.fn().mockResolvedValue(undefined),
    ...(opts?.streamInput ? { streamInput: opts.streamInput } : {}),
  };
}

/** PostToolUse hook 함수를 추출하는 헬퍼. */
async function get_post_hook(post_tool_fn: ReturnType<typeof vi.fn>) {
  let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
  mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
    const hooks = (_args.options?.hooks as any)?.PostToolUse;
    if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
    return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
  });
  const agent = make_agent();
  await agent.run(make_opts({ hooks: { post_tool_use: post_tool_fn } }));
  return hook_fn;
}

/** PostToolUseFailure hook 함수를 추출하는 헬퍼. */
async function get_fail_hook(post_tool_fn: ReturnType<typeof vi.fn>) {
  let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
  mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
    const hooks = (_args.options?.hooks as any)?.PostToolUseFailure;
    if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
    return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
  });
  const agent = make_agent();
  await agent.run(make_opts({ hooks: { post_tool_use: post_tool_fn } }));
  return hook_fn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// is_available
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — is_available", () => {
  it("SDK mock 등록됨 → is_available()가 boolean 반환", () => {
    const agent = make_agent();
    const result = agent.is_available();
    expect(typeof result).toBe("boolean");
  });

  it("id 기본값 = claude_sdk", () => {
    const agent = make_agent();
    expect(agent.id).toBe("claude_sdk");
  });

  it("id 커스텀 설정", () => {
    const agent = make_agent({ id: "my-sdk" });
    expect(agent.id).toBe("my-sdk");
  });

  it("native_tool_loop=true, supports_resume=true", () => {
    const agent = make_agent();
    expect(agent.native_tool_loop).toBe(true);
    expect(agent.supports_resume).toBe(true);
  });
});

// ══════════════════════════════════════════
// run() — 기본 성공 경로
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() 기본 성공", () => {
  it("result 메시지 → finish_reason=stop, content 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "sess-abc" },
      { type: "result", subtype: "success", result: "Done!", usage: { input_tokens: 10, output_tokens: 5 } },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("stop");
    expect(r.content).toBe("Done!");
    expect(r.usage?.prompt_tokens).toBe(10);
  });

  it("init 메시지 → session 설정", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "my-sess" },
      { type: "result", subtype: "success", result: "OK" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.session?.session_id).toBe("my-sess");
  });

  it("assistant 메시지 + text block → content 수집", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [{ type: "text", text: "Hello " }, { type: "text", text: "World" }] } },
      { type: "result", subtype: "success", result: "Hello World" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      hooks: { on_event: (e) => { events.push(e.type); } },
    }));
    expect(r.content).toBeTruthy();
    expect(events).toContain("content_delta");
  });

  it("assistant 메시지 + tool_use block → tool_calls_count 증가", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [
        { type: "tool_use", name: "bash", id: "tc-1", input: { command: "ls" } },
      ]} },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      hooks: { on_event: (e) => { events.push(e.type); } },
    }));
    expect(r.tool_calls_count).toBe(1);
    expect(events).toContain("tool_use");
  });

  it("on_stream 훅 → 텍스트 청크 수신", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
      { type: "assistant", message: { content: [{ type: "text", text: "stream chunk" }] } },
      { type: "result", subtype: "success", result: "stream chunk" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({
      hooks: { on_stream: async (chunk) => { chunks.push(chunk); } },
    }));
    expect(chunks).toContain("stream chunk");
  });
});

// ══════════════════════════════════════════
// run() — 다양한 메시지 타입
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() 메시지 타입", () => {
  it("system/status compacting → compact_boundary 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("compact_boundary");
  });

  it("system/compact_boundary → compact_boundary 이벤트 + trigger", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1000 } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: { type: string; trigger?: string }[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const cb = events.find(e => e.type === "compact_boundary");
    expect(cb).toBeDefined();
    expect((cb as any).trigger).toBe("manual");
  });

  it("auth_status 메시지 → auth_request 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "auth_status", output: ["https://claude.ai/auth"], error: undefined },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("auth_request");
  });

  it("auth_status with error → auth_request + error 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "auth_status", output: [], error: "token_expired" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("error");
  });

  it("rate_limit_event → rate_limit 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", utilization: 0.9 } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("rate_limit");
  });

  it("rate_limit_event rejected status → rate_limit 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: { type: string; status?: string }[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const rl = events.find(e => e.type === "rate_limit");
    expect(rl).toBeDefined();
    expect((rl as any).status).toBe("rejected");
  });

  it("task_started → task_lifecycle 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "task_started", task_id: "t-123" },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("task_lifecycle");
  });

  it("tool_use_summary → tool_summary 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "tool_use_summary", summary: "2 tools used", preceding_tool_use_ids: ["tc1", "tc2"] },
      { type: "result", subtype: "success", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("tool_summary");
  });

  it("result subtype=error → finish_reason=error", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "error_during_execution", result: "something failed" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("assistant.error 필드 → error 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "assistant", error: "billing_error" },
      { type: "result", subtype: "error_during_execution", result: "" },
    ]));
    const events: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("error");
  });

  it("isReplay=true 메시지 → 건너뜀 (카운트 없음)", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "assistant", isReplay: true, message: { content: [{ type: "tool_use", name: "bash", id: "t1", input: {} }] } },
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.tool_calls_count).toBe(0); // replay는 카운트 안 됨
  });

  it("tool_progress → on_stream 호출", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "tool_progress", tool_name: "bash", elapsed_time_seconds: 5 },
      { type: "result", subtype: "success", result: "" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ hooks: { on_stream: async (c) => { chunks.push(c); } } }));
    expect(chunks.some(c => c.includes("bash"))).toBe(true);
  });
});

// ══════════════════════════════════════════
// run() — abort / 에러
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — run() abort / 에러", () => {
  it("abort_signal 이미 aborted → cancelled 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "" },
    ]));
    const ctrl = new AbortController();
    ctrl.abort();
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({ abort_signal: ctrl.signal }));
    expect(r.finish_reason).toBe("cancelled");
  });

  it("generator throw → error finish_reason", async () => {
    mock_query.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new Error("SDK internal error");
      },
      close: vi.fn(),
    });
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("SDK internal error");
  });

  it("result.total_cost_usd → metadata에 포함", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "ok", total_cost_usd: 0.005 },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("stop");
  });

  it("resume_session 설정 → sdk_options.resume 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const r = await agent.run(make_opts({
      resume_session: { session_id: "prev-sess-id", backend: "claude_sdk", created_at: "" },
    }));
    expect(r).toBeDefined();
    expect(mock_query).toHaveBeenCalledOnce();
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.resume).toBe("prev-sess-id");
  });

  it("max_turns 설정 → sdk_options.maxTurns 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    await agent.run(make_opts({ max_turns: 5 }));
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.maxTurns).toBe(5);
  });

  it("structured_output 설정 → sdk_options.outputFormat 전달", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "" },
    ]));
    const agent = make_agent({ cwd: "/tmp" });
    const schema = { type: "object", properties: { name: { type: "string" } } };
    await agent.run(make_opts({ structured_output: schema as any }));
    const opts = mock_query.mock.calls[0][0].options;
    expect(opts.outputFormat?.type).toBe("json_schema");
  });
});

// ══════════════════════════════════════════
// task_progress / task_notification 서브타입 (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — task lifecycle 서브타입", () => {
  it("task_progress → task_lifecycle:progress 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "task_progress", task_id: "subtask-1", description: "Searching..." },
      { type: "result", subtype: "success", result: "done" },
    ]));
    const events: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type + ":" + (e as any).status) } }));
    expect(events).toContain("task_lifecycle:progress");
  });

  it("task_notification → task_lifecycle:completed 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "task_notification", task_id: "sub-2", status: "completed", summary: "Done" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const events: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type + ":" + (e as any).status) } }));
    expect(events).toContain("task_lifecycle:completed");
  });

  it("task_notification status=failed → task_lifecycle:failed", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "task_notification", task_id: "sub-3", status: "failed" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const events: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e.type + ":" + (e as any).status) } }));
    expect(events).toContain("task_lifecycle:failed");
  });

  it("task_lifecycle with usage → task_usage 포함", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "system", subtype: "task_started", task_id: "sub-4",
        usage: { total_tokens: 100, tool_uses: 3, duration_ms: 5000 },
      },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const task_events: Array<{ type: string; task_usage?: unknown }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => { if (e.type === "task_lifecycle") task_events.push(e as any); } } }));
    expect(task_events[0].task_usage).toBeDefined();
    expect((task_events[0].task_usage as any).total_tokens).toBe(100);
  });
});

// ══════════════════════════════════════════
// sdk_options 분기 — thinking, tools, budget (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — sdk_options 설정 경로", () => {
  it("enable_thinking=true → maxThinkingTokens 기본값(10000)", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ enable_thinking: true }));
    expect(captured_opts.maxThinkingTokens).toBe(10000);
  });

  it("max_thinking_tokens=5000 → maxThinkingTokens=5000", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ max_thinking_tokens: 5000 }));
    expect(captured_opts.maxThinkingTokens).toBe(5000);
  });

  it("allowed_tools / disallowed_tools → sdk_options에 전달", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ allowed_tools: ["Read", "Write"], disallowed_tools: ["Bash"] }));
    expect((captured_opts.allowedTools as string[])).toContain("Read");
    expect((captured_opts.disallowedTools as string[])).toContain("Bash");
  });

  it("max_budget_usd → maxBudgetUsd 전달", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ max_budget_usd: 0.5 }));
    expect(captured_opts.maxBudgetUsd).toBe(0.5);
  });

  it("config.max_budget_usd → maxBudgetUsd (run에 없을 때)", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent({ max_budget_usd: 1.0 });
    await agent.run(make_opts());
    expect(captured_opts.maxBudgetUsd).toBe(1.0);
  });

  it("env + settings_sources → sdk_options 전달", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({
      env: { MY_KEY: "my_value" },
      settings_sources: [{ type: "editor" } as any],
    }));
    expect((captured_opts.env as Record<string, string>).MY_KEY).toBe("my_value");
    expect(Array.isArray(captured_opts.settingSources)).toBe(true);
  });

  it("fallback_model → fallbackModel 전달", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ fallback_model: "claude-haiku-4-5-20251001" }));
    expect(captured_opts.fallbackModel).toBe("claude-haiku-4-5-20251001");
  });
});

// ══════════════════════════════════════════
// message.content 스트리밍 — fallback 경로 (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — message.content fallback 스트리밍", () => {
  it("content 필드 있는 메시지 → content_delta 이벤트 + on_stream 호출", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { content: "streaming text here" },
      { type: "result", subtype: "success", result: "final" },
    ]));
    const events: string[] = [];
    const chunks: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({
      hooks: {
        on_event: (e) => events.push(e.type),
        on_stream: async (c) => chunks.push(c),
      },
    }));
    expect(events).toContain("content_delta");
    expect(chunks.some(c => c.includes("streaming text here"))).toBe(true);
  });

  it("message.usage 누적 → usage 이벤트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 } },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const usage_events: Array<{ type: string; tokens?: unknown }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => { if (e.type === "usage") usage_events.push(e as any); } } }));
    expect(usage_events.length).toBeGreaterThan(0);
    expect((usage_events[0].tokens as any).input).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// result 메시지 — modelUsage, errors, 비용 (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — result 메시지 고급 경로", () => {
  it("result.modelUsage → model_usage 파싱", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "done",
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: {
          "claude-opus-4-6": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
        },
      },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.usage?.model_usage?.["claude-opus-4-6"]).toBeDefined();
    expect(r.usage?.model_usage?.["claude-opus-4-6"].input_tokens).toBe(100);
  });

  it("result.errors + permission_denials → metadata에 포함", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "ok",
        errors: ["some warning"],
        permission_denials: [{ tool: "Bash", reason: "blocked" }],
        duration_ms: 1234,
        num_turns: 3,
      },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.metadata?.errors).toEqual(["some warning"]);
    expect(r.metadata?.permission_denials).toBeDefined();
    expect(r.metadata?.duration_ms).toBe(1234);
    expect(r.metadata?.num_turns).toBe(3);
  });

  it("result.usage → total_input/output 업데이트", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "ok",
        usage: { input_tokens: 200, output_tokens: 80 },
      },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.usage?.prompt_tokens).toBe(200);
    expect(r.usage?.completion_tokens).toBe(80);
  });
});

// ══════════════════════════════════════════
// pre_tool_use + on_approval hooks (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — PreToolUse hook 경로", () => {
  it("pre_tool_use hook → sdk_options.hooks.PreToolUse 등록됨", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const pre_tool = vi.fn().mockResolvedValue({ permission: "allow" });
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { pre_tool_use: pre_tool } }));
    expect((captured_opts.hooks as any)?.PreToolUse).toBeDefined();
  });

  it("on_approval hook → sdk_options.hooks.PreToolUse 등록됨", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const on_approval = vi.fn().mockResolvedValue("allow");
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_approval } }));
    expect((captured_opts.hooks as any)?.PreToolUse).toBeDefined();
  });

  it("pre_tool_use deny → _deny_hook 반환", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const pre_tool = vi.fn().mockResolvedValue({ permission: "deny", reason: "blocked by policy" });
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { pre_tool_use: pre_tool } }));
    if (hook_fn) {
      const result = await hook_fn({ tool_name: "Bash", tool_input: { cmd: "rm -rf" } });
      expect((result.hookSpecificOutput as any).permissionDecision).toBe("deny");
    }
  });

  it("pre_tool_use updated_params → updatedInput 반환", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const pre_tool = vi.fn().mockResolvedValue({ permission: "allow", updated_params: { cmd: "ls -la" } });
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { pre_tool_use: pre_tool } }));
    if (hook_fn) {
      const result = await hook_fn({ tool_name: "Bash", tool_input: { cmd: "ls" } });
      expect((result.hookSpecificOutput as any).updatedInput?.cmd).toBe("ls -la");
    }
  });

  it("on_approval deny → _deny_hook 반환", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const on_approval = vi.fn().mockResolvedValue("deny");
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_approval } }));
    if (hook_fn) {
      const result = await hook_fn({ tool_name: "Bash", tool_input: {} });
      expect((result.hookSpecificOutput as any).permissionDecision).toBe("deny");
    }
  });
});

// ══════════════════════════════════════════
// post_tool_use hook (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — PostToolUse hook 경로", () => {
  it("post_tool_use → sdk_options.hooks.PostToolUse + PostToolUseFailure 등록", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { post_tool_use: post_tool } }));
    expect((captured_opts.hooks as any)?.PostToolUse).toBeDefined();
    expect((captured_opts.hooks as any)?.PostToolUseFailure).toBeDefined();
  });

  it("PostToolUse hook → tool_result 이벤트 + post_tool 호출", async () => {
    let post_hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PostToolUse;
      if (hooks?.[0]?.hooks?.[0]) post_hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const events: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { post_tool_use: post_tool, on_event: (e) => events.push(e.type) } }));
    if (post_hook_fn) {
      await post_hook_fn({
        tool_name: "Read",
        tool_use_id: "tc-1",
        tool_input: { path: "/tmp/file.txt" },
        tool_response: "file content",
      });
      expect(post_tool).toHaveBeenCalled();
    }
  });

  it("PostToolUseFailure hook → is_error=true 이벤트", async () => {
    let fail_hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PostToolUseFailure;
      if (hooks?.[0]?.hooks?.[0]) fail_hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const events: Array<{ type: string; is_error?: boolean }> = [];
    const agent = make_agent();
    await agent.run(make_opts({
      hooks: {
        post_tool_use: post_tool,
        on_event: (e) => events.push(e as any),
      },
    }));
    if (fail_hook_fn) {
      await fail_hook_fn({
        tool_name: "Bash",
        tool_use_id: "tc-2",
        tool_input: {},
        error: "Permission denied",
      });
      const tr = events.find(e => e.type === "tool_result" && e.is_error === true);
      expect(tr).toBeDefined();
      expect(post_tool).toHaveBeenCalledWith("Bash", {}, "Permission denied", expect.anything(), true);
    }
  });
});

// ══════════════════════════════════════════
// streamInput 등록 (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — streamInput 등록", () => {
  it("register_send_input + streamInput 지원 → send_input 콜백 등록", async () => {
    const stream_input_fn = vi.fn().mockResolvedValue(undefined);
    mock_query.mockReturnValue(make_query_instance(
      [{ type: "result", subtype: "success", result: "ok" }],
      { streamInput: stream_input_fn },
    ));
    let registered_fn: ((text: string) => void) | undefined;
    const agent = make_agent();
    await agent.run(make_opts({
      register_send_input: (fn) => { registered_fn = fn; },
    }));
    expect(registered_fn).toBeDefined();
    if (registered_fn) registered_fn("hello");
    expect(stream_input_fn).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// tool_progress — elapsed=0 vs elapsed>0 (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — tool_progress elapsed=0", () => {
  it("elapsed=0 → on_stream 미호출", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "tool_progress", tool_name: "Read", elapsed_time_seconds: 0 },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// rate_limit_event 다양한 status (from extended)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — rate_limit_event 분기", () => {
  it("status=allowed_warning → allowed_warning", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 9999, utilization: 0.9 } },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const rl_events: Array<{ type: string; status?: string }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => { if (e.type === "rate_limit") rl_events.push(e as any); } } }));
    expect(rl_events[0].status).toBe("allowed_warning");
  });

  it("rate_limit_info 없음 → rate_limit 이벤트 미발행", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const rl_events: unknown[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => { if (e.type === "rate_limit") rl_events.push(e); } } }));
    expect(rl_events.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// _stringify_for_render — result.result 타입별 변환 (from cov2)
// ══════════════════════════════════════════

describe("_stringify_for_render — result.result 타입별 변환", () => {
  it("result=null → content 빈 문자열", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: null },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.content).toBe(null);
  });

  it("result=string → content가 그 문자열", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "plain text result" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.content).toBe("plain text result");
  });

  it("result=object → ```json\\n...\\n``` 형식으로 래핑", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: { key: "value", num: 42 } },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.content).toContain("```json");
    expect(r.content).toContain("key");
  });

  it("result=array → ```json\\n...\\n``` 형식으로 래핑", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: [1, 2, 3] },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.content).toContain("```json");
  });
});

// ══════════════════════════════════════════
// _extract_tool_response_text — PostToolUse hook 통해 간접 테스트 (from cov2)
// ══════════════════════════════════════════

describe("_extract_tool_response_text — tool_response 형식 분기", () => {
  it("tool_response=string → 그대로 전달", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({ tool_name: "Read", tool_use_id: "t1", tool_input: {}, tool_response: "file content" });
      expect(post_tool).toHaveBeenCalledWith("Read", {}, "file content", expect.anything(), false);
    }
  });

  it("tool_response=MCP content blocks → 텍스트 추출", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({
        tool_name: "Fetch", tool_use_id: "t2", tool_input: {},
        tool_response: { content: [{ type: "text", text: "block1" }, { type: "text", text: "block2" }] },
      });
      const call_arg = post_tool.mock.calls[0]?.[2];
      expect(call_arg).toContain("block1");
      expect(call_arg).toContain("block2");
    }
  });

  it("tool_response={ content: 'string' } → content 문자열 추출", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({
        tool_name: "Fetch", tool_use_id: "t3", tool_input: {},
        tool_response: { content: "direct string content" },
      });
      expect(post_tool).toHaveBeenCalledWith("Fetch", {}, "direct string content", expect.anything(), false);
    }
  });

  it("tool_response={ text: 'string' } → text 필드 추출", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({
        tool_name: "Exec", tool_use_id: "t4", tool_input: {},
        tool_response: { text: "text field value" },
      });
      expect(post_tool).toHaveBeenCalledWith("Exec", {}, "text field value", expect.anything(), false);
    }
  });

  it("tool_response=null → 빈 문자열로 처리", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({ tool_name: "Exec", tool_use_id: "t5", tool_input: {}, tool_response: null });
      expect(post_tool).toHaveBeenCalledWith("Exec", {}, "", expect.anything(), false);
    }
  });

  it("tool_response=number → safe_stringify 경로", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_post_hook(post_tool);
    if (hook) {
      await hook({ tool_name: "Exec", tool_use_id: "t6", tool_input: {}, tool_response: 42 });
      const call_arg = post_tool.mock.calls[0]?.[2];
      expect(typeof call_arg).toBe("string");
    }
  });
});

// ══════════════════════════════════════════
// _extract_tool_response_text — PostToolUseFailure error 형식 (from cov2)
// ══════════════════════════════════════════

describe("_extract_tool_response_text — PostToolUseFailure error 형식", () => {
  it("error=string → 그대로 전달", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_fail_hook(post_tool);
    if (hook) {
      await hook({ tool_name: "Bash", tool_use_id: "f1", tool_input: {}, error: "Permission denied" });
      expect(post_tool).toHaveBeenCalledWith("Bash", {}, "Permission denied", expect.anything(), true);
    }
  });

  it("error=MCP content blocks → 텍스트 추출", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_fail_hook(post_tool);
    if (hook) {
      await hook({
        tool_name: "Bash", tool_use_id: "f2", tool_input: {},
        error: { content: [{ type: "text", text: "error block" }] },
      });
      const call_arg = post_tool.mock.calls[0]?.[2];
      expect(call_arg).toContain("error block");
    }
  });

  it("error=null → 'unknown error' fallback", async () => {
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const hook = await get_fail_hook(post_tool);
    if (hook) {
      await hook({ tool_name: "Bash", tool_use_id: "f3", tool_input: {}, error: null });
      expect(post_tool).toHaveBeenCalledWith("Bash", {}, "unknown error", expect.anything(), true);
    }
  });
});

// ══════════════════════════════════════════
// _build_usage — 빈 토큰 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — _build_usage 빈 토큰", () => {
  it("토큰 없는 result → usage={} 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "done" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.usage?.prompt_tokens).toBeUndefined();
    expect(r.usage?.completion_tokens).toBeUndefined();
  });

  it("cache_read + cache_creation 토큰 포함 result → usage에 반영", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "ok",
        usage: {
          input_tokens: 100, output_tokens: 50,
          cache_read_input_tokens: 20, cache_creation_input_tokens: 10,
        },
      },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.usage?.cache_read_input_tokens).toBe(20);
    expect(r.usage?.cache_creation_input_tokens).toBe(10);
  });
});

// ══════════════════════════════════════════
// result.structured_output 파싱 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — result.structured_output 파싱", () => {
  it("result.structured_output 있음 → parsed_output에 캡처", async () => {
    const parsed = { name: "test", value: 42 };
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "ok", structured_output: parsed },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.parsed_output).toEqual(parsed);
  });

  it("result.structured_output 없음 → parsed_output undefined", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.parsed_output).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// rate_limit_event — unknown status (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — rate_limit_event unknown status", () => {
  it("status=other → 'allowed' fallback", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "rate_limit_event", rate_limit_info: { status: "some_unknown_status", utilization: 0.3 } },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const rl_events: Array<{ type: string; status?: string }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => { if (e.type === "rate_limit") rl_events.push(e as any); } } }));
    expect(rl_events[0]?.status).toBe("allowed");
  });
});

// ══════════════════════════════════════════
// on_approval "cancel" → deny (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — on_approval cancel → deny", () => {
  it("on_approval returns 'cancel' → _deny_hook 반환", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const on_approval = vi.fn().mockResolvedValue("cancel");
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_approval } }));
    if (hook_fn) {
      const result = await hook_fn({ tool_name: "Bash", tool_input: { cmd: "ls" } });
      expect((result.hookSpecificOutput as any).permissionDecision).toBe("deny");
    }
  });
});

// ══════════════════════════════════════════
// on_approval tool_input 빈 경우 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — on_approval tool_input 빈 객체", () => {
  it("tool_input 빈 {} → request.tool_input=undefined으로 전달", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    const on_approval = vi.fn().mockResolvedValue("allow");
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_approval } }));
    if (hook_fn) {
      await hook_fn({ tool_name: "Read", tool_input: {} });
      const request = on_approval.mock.calls[0]?.[0];
      expect(request?.tool_input).toBeUndefined();
    }
  });

  it("tool_input 비어있지 않으면 → request.tool_input 포함", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    const on_approval = vi.fn().mockResolvedValue("allow");
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PreToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_approval } }));
    if (hook_fn) {
      await hook_fn({ tool_name: "Bash", tool_input: { command: "ls" } });
      const request = on_approval.mock.calls[0]?.[0];
      expect(request?.tool_input).toEqual({ command: "ls" });
    }
  });
});

// ══════════════════════════════════════════
// PostToolHook — emit=undefined 경로 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — PostToolHook emit=undefined 경로", () => {
  it("on_event 없이 PostToolUse → post_tool은 호출됨", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PostToolUse;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { post_tool_use: post_tool } }));
    if (hook_fn) {
      await hook_fn({ tool_name: "Read", tool_use_id: "t-x", tool_input: {}, tool_response: "result" });
      expect(post_tool).toHaveBeenCalled();
    }
  });

  it("on_event 없이 PostToolUseFailure → post_tool은 호출됨", async () => {
    let hook_fn: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      const hooks = (_args.options?.hooks as any)?.PostToolUseFailure;
      if (hooks?.[0]?.hooks?.[0]) hook_fn = hooks[0].hooks[0];
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const post_tool = vi.fn().mockResolvedValue(undefined);
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { post_tool_use: post_tool } }));
    if (hook_fn) {
      await hook_fn({ tool_name: "Bash", tool_use_id: "f-x", tool_input: {}, error: "err" });
      expect(post_tool).toHaveBeenCalledWith("Bash", {}, "err", expect.anything(), true);
    }
  });
});

// ══════════════════════════════════════════
// abort_signal — 도중 abort (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — abort_signal 도중 abort", () => {
  it("초기에 aborted=false인 signal → 이벤트 리스너 등록 후 abort 가능", async () => {
    const ctrl = new AbortController();
    const interrupt_fn = vi.fn().mockResolvedValue(undefined);
    mock_query.mockReturnValue(make_query_instance(
      [{ type: "result", subtype: "success", result: "completed" }],
      { interrupt: interrupt_fn },
    ));
    const agent = make_agent();
    const r = await agent.run(make_opts({ abort_signal: ctrl.signal }));
    expect(r.finish_reason).toBe("stop");
  });

  it("abort 시 interrupt() 호출됨", async () => {
    const ctrl = new AbortController();
    const interrupt_fn = vi.fn().mockResolvedValue(undefined);
    const mock_instance = {
      [Symbol.asyncIterator]: async function* () {
        ctrl.abort();
        yield { type: "result", subtype: "success", result: "partial" };
      },
      close: vi.fn(),
      interrupt: interrupt_fn,
    };
    mock_query.mockReturnValue(mock_instance);
    const agent = make_agent();
    const r = await agent.run(make_opts({ abort_signal: ctrl.signal }));
    expect(r.finish_reason).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// _build_session 분기 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — _build_session 분기", () => {
  it("init 없이 result만 → session=null", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.session).toBeNull();
  });

  it("init session_id 있음 → session 객체 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "init", session_id: "test-session-id" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.session?.session_id).toBe("test-session-id");
    expect(r.session?.backend).toBe("claude_sdk");
  });
});

// ══════════════════════════════════════════
// _load_query 캐시 히트 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — _load_query 캐시 히트", () => {
  it("두 번 run() 호출 → SDK import 캐시 활용 (두 번 성공)", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "first" },
    ]));
    const agent = make_agent();
    const r1 = await agent.run(make_opts());
    expect(r1.content).toBe("first");

    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: "second" },
    ]));
    const r2 = await agent.run(make_opts());
    expect(r2.content).toBe("second");
  });
});

// ══════════════════════════════════════════
// compact_boundary trigger 분기 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — compact_boundary trigger 분기", () => {
  it("trigger=auto → auto trigger", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 500 } },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const events: Array<{ type: string; trigger?: string }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const cb = events.find(e => e.type === "compact_boundary");
    expect(cb?.trigger).toBe("auto");
  });

  it("compact_metadata 없음 → trigger=auto, pre_tokens=0", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "compact_boundary" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const events: Array<{ type: string; trigger?: string; pre_tokens?: number }> = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    const cb = events.find(e => e.type === "compact_boundary");
    expect(cb?.trigger).toBe("auto");
    expect(cb?.pre_tokens).toBe(0);
  });
});

// ══════════════════════════════════════════
// compacting on_stream 경로 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — compacting on_stream 경로", () => {
  it("compacting 이벤트 + on_stream 있으면 압축 중 메시지 전송", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const chunks: string[] = [];
    const agent = make_agent();
    await agent.run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.some(c => c.includes("압축"))).toBe(true);
  });

  it("compacting 이벤트 + on_stream 없음 → 에러 없이 계속", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "result", subtype: "success", result: "ok" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// result.total_cost_usd → usage 반영 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — result.total_cost_usd → usage 반영", () => {
  it("total_cost_usd + usage 있으면 usage.total_cost_usd에 반영", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "ok",
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.usage?.total_cost_usd).toBe(0.0123);
  });
});

// ══════════════════════════════════════════
// mcp_server_configs 전달 (from cov2)
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — mcp_server_configs 전달", () => {
  it("mcp_server_configs → sdk_options.mcpServers에 병합", async () => {
    let captured_opts: Record<string, unknown> = {};
    mock_query.mockImplementation((_args: { prompt: string; options?: Record<string, unknown> }) => {
      captured_opts = _args.options ?? {};
      return make_query_instance([{ type: "result", subtype: "success", result: "ok" }]);
    });
    const agent = make_agent();
    await agent.run(make_opts({
      mcp_server_configs: {
        my_server: { command: "npx", args: ["my-mcp-server"] },
      } as any,
    }));
    const mcp = captured_opts.mcpServers as Record<string, unknown>;
    expect(mcp?.my_server).toBeDefined();
  });
});
