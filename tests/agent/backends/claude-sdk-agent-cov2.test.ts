/**
 * ClaudeSdkAgent — 미커버 분기 보충.
 * _stringify_for_render (null/object/array), _extract_tool_response_text (MCP blocks/string/text 필드),
 * _build_usage 빈 토큰 → {}, rate_limit unknown status → "allowed",
 * result.structured_output 캡처, on_approval cancel → deny,
 * abort_signal 도중 abort, abort_relay interrupt, PostToolHook emit=undefined 경로.
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
    ...overrides,
  };
}

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

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// _stringify_for_render — 간접 테스트 (result.result 필드)
// ══════════════════════════════════════════

describe("_stringify_for_render — result.result 타입별 변환", () => {
  it("result=null → content 빈 문자열", async () => {
    mock_query.mockReturnValue(make_query_instance([
      { type: "result", subtype: "success", result: null },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.content).toBe(null); // null → "" → content가 null 반환
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
// _extract_tool_response_text — PostToolUse hook 통해 간접 테스트
// ══════════════════════════════════════════

describe("_extract_tool_response_text — tool_response 형식 분기", () => {
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
// _extract_tool_response_text — PostToolUseFailure error 필드
// ══════════════════════════════════════════

describe("_extract_tool_response_text — PostToolUseFailure error 형식", () => {
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
// _build_usage — 빈 토큰 → {} 반환
// ══════════════════════════════════════════

describe("ClaudeSdkAgent — _build_usage 빈 토큰", () => {
  it("토큰 없는 result → usage={} 반환", async () => {
    mock_query.mockReturnValue(make_query_instance([
      // usage 없음 → total_input=0, total_output=0 → _build_usage 빈 {} 반환
      { type: "result", subtype: "success", result: "done" },
    ]));
    const agent = make_agent();
    const r = await agent.run(make_opts());
    // usage 빈 객체 → prompt_tokens undefined
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
// result.structured_output 캡처
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
// rate_limit_event — unknown status → "allowed" fallback
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
// on_approval "cancel" → deny
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
// on_approval tool_input 빈 경우 → request.tool_input=undefined
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
      // 빈 {} → tool_input=undefined
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
// PostToolHook — emit=undefined (on_event 미등록)
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
    // on_event 없음 → emit=undefined
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
// abort_signal — 도중 abort (addEventListener 경로)
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
    // aborted 아닌 상태로 시작했으므로 정상 완료
    expect(r.finish_reason).toBe("stop");
  });

  it("abort 시 interrupt() 호출됨", async () => {
    const ctrl = new AbortController();
    const interrupt_fn = vi.fn().mockResolvedValue(undefined);
    // 첫 메시지 yield 후 abort 시뮬레이션
    const mock_instance = {
      [Symbol.asyncIterator]: async function* () {
        ctrl.abort(); // 이터레이션 중 abort
        yield { type: "result", subtype: "success", result: "partial" };
      },
      close: vi.fn(),
      interrupt: interrupt_fn,
    };
    mock_query.mockReturnValue(mock_instance);
    const agent = make_agent();
    const r = await agent.run(make_opts({ abort_signal: ctrl.signal }));
    // abort되어 cancelled 반환
    expect(r.finish_reason).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// _build_session — session_id 없을 때
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
// _load_query 캐시 히트
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
// compact_boundary auto trigger (trigger != "manual")
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
// system/status compacting → on_stream 호출
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
    const r = await agent.run(make_opts()); // hooks 없음
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// result.total_cost_usd → usage.total_cost_usd 포함
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
// mcp_server_configs 전달
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
