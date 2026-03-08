/**
 * ClaudeSdkAgent — 추가 경로 커버리지 (extended).
 * task_progress/notification, hooks (pre/post), thinking, tools, content streaming, usage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── SDK mock ──────────────────────────────────────────────────────
const { mock_query } = vi.hoisted(() => ({ mock_query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mock_query }));

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

function make_query_instance(
  messages: Record<string, unknown>[],
  opts?: { close?: () => void; streamInput?: (it: AsyncIterable<unknown>) => Promise<void> }
) {
  return {
    [Symbol.asyncIterator]: async function* () { for (const msg of messages) yield msg; },
    close: opts?.close ?? vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    ...(opts?.streamInput ? { streamInput: opts.streamInput } : {}),
  };
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// task_progress / task_notification 서브타입
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
// sdk_options 분기 — thinking, tools, budget
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
// message.content 스트리밍 (fallback 경로)
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
// result 메시지 — modelUsage, errors, 비용
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — result 메시지 고급 경로", () => {
  it("result.modelUsage → model_usage 파싱", async () => {
    mock_query.mockReturnValue(make_query_instance([
      {
        type: "result", subtype: "success", result: "done",
        // usage가 있어야 _build_usage가 {} 대신 실제 값 반환
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
// pre_tool_use + on_approval hooks
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
// post_tool_use hook
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
// streamInput 등록
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
// tool_progress — elapsed=0 vs elapsed>0
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
    // elapsed=0이면 on_stream 미호출
    expect(chunks.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// rate_limit_event 다양한 status
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
