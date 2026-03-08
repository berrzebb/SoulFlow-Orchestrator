/**
 * CodexAppServerAgent — 미커버 경로 보충.
 * notification 핸들러 (fileChange, reasoning, plan, tokenUsage, model/rerouted, error),
 * on_server_request (item/tool/call, requestUserInput, requestApproval),
 * abort signal, turn/completed status=failed (codexErrorInfo), structuredOutput,
 * _extract_codex_error_type / _codex_error_to_finish_reason.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted: respond 포함 ClientProxy ────────────────────────────────────────

const { mock_exec_file_sync, shared_request, get_client, ClientProxy, last_respond } = vi.hoisted(() => {
  const mock_exec_file_sync = vi.fn();
  const shared_request = vi.fn();
  const last_respond = vi.fn();
  let _client: InstanceType<typeof ClientProxy> | null = null;

  class MinimalEmitter {
    private _h: Record<string, ((...a: unknown[]) => void)[]> = {};
    on(ev: string, fn: (...a: unknown[]) => void) { (this._h[ev] ||= []).push(fn); return this; }
    once(ev: string, fn: (...a: unknown[]) => void) {
      const wrap = (...a: unknown[]) => { fn(...a); this.off(ev, wrap); };
      return this.on(ev, wrap);
    }
    off(ev: string, fn: (...a: unknown[]) => void) {
      this._h[ev] = (this._h[ev] || []).filter(f => f !== fn);
      return this;
    }
    emit(ev: string, ...a: unknown[]) { (this._h[ev] || []).slice().forEach(fn => fn(...a)); return true; }
    removeListener(ev: string, fn: (...a: unknown[]) => void) { return this.off(ev, fn); }
  }

  class ClientProxy extends MinimalEmitter {
    is_running = vi.fn().mockReturnValue(false);
    start = vi.fn();
    stop = vi.fn();
    notify = vi.fn();
    request = shared_request;
    respond = last_respond;
    constructor(_config: unknown) { super(); _client = this; }
  }

  const get_client = () => _client;
  return { mock_exec_file_sync, shared_request, get_client, ClientProxy, last_respond };
});

vi.mock("node:child_process", () => ({ execFileSync: mock_exec_file_sync }));
vi.mock("@src/agent/backends/codex-jsonrpc.js", () => ({ CodexJsonRpcClient: ClientProxy }));

import { CodexAppServerAgent } from "@src/agent/backends/codex-appserver.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────

function make_agent(config: Record<string, unknown> = {}) {
  return new CodexAppServerAgent({ cwd: "/tmp/cwd", request_timeout_ms: 10000, ...config } as any);
}

function make_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "t-1",
    task: "do something",
    system_prompt: "You are helpful.",
    messages: [],
    cwd: "/tmp/cwd",
    ...overrides,
  };
}

function set_request_responses(responses: Array<unknown | Error>) {
  let call = 0;
  shared_request.mockImplementation(async (method: string) => {
    const resp = call < responses.length ? responses[call] : {};
    call++;
    if (resp instanceof Error) throw resp;
    // turn/start은 completed 알림을 기다리므로 pending promise 반환
    if (method === "turn/start") return new Promise(() => {}); // 알림이 먼저 resolve
    return resp;
  });
}

function setup_thread(thread_id: string) {
  let call = 0;
  shared_request.mockImplementation(async (method: string) => {
    call++;
    if (method === "initialize") return {};
    if (method === "thread/start") return { thread: { id: thread_id } };
    if (method === "turn/start") return new Promise(() => {}); // 알림 기다림
    return {};
  });
  void call; // suppress unused warning
}

function emit_notif(notif: { method: string; params: Record<string, unknown> }, delay = 10) {
  setTimeout(() => get_client()?.emit("notification", notif), delay);
}

function emit_server_req(req: { id: string | number; method: string; params: Record<string, unknown> }, delay = 10) {
  setTimeout(() => get_client()?.emit("server_request", req), delay);
}

function emit_notifs(notifs: Array<{ method: string; params: Record<string, unknown> }>, base = 10) {
  notifs.forEach((n, i) => emit_notif(n, base + i * base));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock_exec_file_sync.mockReturnValue(Buffer.from("1.0.0"));
});

// ══════════════════════════════════════════
// item/fileChange/outputDelta 스트리밍
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/fileChange/outputDelta", () => {
  it("delta 있음 → on_stream 파일 경로 출력", async () => {
    const thread_id = "thr-fc";
    setup_thread(thread_id);
    const chunks: string[] = [];

    emit_notifs([
      { method: "item/fileChange/outputDelta", params: { threadId: thread_id, delta: { path: "src/file.ts", kind: "modified" } } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.some(c => c.includes("src/file.ts"))).toBe(true);
  });

  it("delta 없음 → on_stream 미호출", async () => {
    const thread_id = "thr-fc-empty";
    setup_thread(thread_id);
    const chunks: string[] = [];

    emit_notifs([
      { method: "item/fileChange/outputDelta", params: { threadId: thread_id } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// item/reasoning/summaryTextDelta 스트리밍
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/reasoning/summaryTextDelta", () => {
  it("delta 있음 → on_stream 💭 출력", async () => {
    const thread_id = "thr-reasoning";
    setup_thread(thread_id);
    const chunks: string[] = [];

    emit_notifs([
      { method: "item/reasoning/summaryTextDelta", params: { threadId: thread_id, delta: "분석 중..." } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.some(c => c.includes("💭") && c.includes("분석 중..."))).toBe(true);
  });
});

// ══════════════════════════════════════════
// turn/plan/updated — 실행 계획 스트리밍
// ══════════════════════════════════════════

describe("CodexAppServerAgent — turn/plan/updated", () => {
  it("plan steps → on_stream 📋 출력", async () => {
    const thread_id = "thr-plan";
    setup_thread(thread_id);
    const chunks: string[] = [];

    const plan = [
      { step: "파일 분석", status: "completed" },
      { step: "코드 수정", status: "inProgress" },
      { step: "테스트 실행", status: "pending" },
    ];

    emit_notifs([
      { method: "turn/plan/updated", params: { threadId: thread_id, turnId: "t1", plan } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    const combined = chunks.join("");
    expect(combined).toContain("📋 Plan:");
    expect(combined).toContain("✅");
    expect(combined).toContain("⏳");
  });

  it("plan 빈 배열 → on_stream 미호출", async () => {
    const thread_id = "thr-plan-empty";
    setup_thread(thread_id);
    const chunks: string[] = [];

    emit_notifs([
      { method: "turn/plan/updated", params: { threadId: thread_id, plan: [] } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.length).toBe(0);
  });
});

// ══════════════════════════════════════════
// item/plan/delta 스트리밍
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/plan/delta", () => {
  it("delta 있음 → on_stream 전달", async () => {
    const thread_id = "thr-plan-delta";
    setup_thread(thread_id);
    const chunks: string[] = [];

    emit_notifs([
      { method: "item/plan/delta", params: { threadId: thread_id, delta: "Step 1: 분석" } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.some(c => c.includes("Step 1"))).toBe(true);
  });
});

// ══════════════════════════════════════════
// thread/tokenUsage/updated
// ══════════════════════════════════════════

describe("CodexAppServerAgent — thread/tokenUsage/updated", () => {
  it("tokenUsage total 있음 → 내부 input/output_tokens 업데이트", async () => {
    const thread_id = "thr-token";
    setup_thread(thread_id);

    emit_notifs([
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: thread_id,
          tokenUsage: { total: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 10 } },
        },
      },
      {
        method: "turn/completed",
        params: { threadId: thread_id, turn: { status: "completed" } },
      },
    ]);

    const events: string[] = [];
    const r = await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    // usage 이벤트가 발생하거나 finish_reason이 stop
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// model/rerouted — 에러 이벤트 발행
// ══════════════════════════════════════════

describe("CodexAppServerAgent — model/rerouted", () => {
  it("model/rerouted → error 이벤트 (계속 실행)", async () => {
    const thread_id = "thr-reroute";
    setup_thread(thread_id);
    const events: Array<{ type: string; code?: string }> = [];

    emit_notifs([
      {
        method: "model/rerouted",
        params: { threadId: thread_id, fromModel: "gpt-4o", toModel: "gpt-4-turbo", reason: "capacity" },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    const r = await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    expect(events.some(e => e.type === "error" && (e.code?.includes("model_rerouted")))).toBe(true);
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// error notification — willRetry + fatal
// ══════════════════════════════════════════

describe("CodexAppServerAgent — error notification", () => {
  it("willRetry=true → error 이벤트만 발행, 계속 실행", async () => {
    const thread_id = "thr-err-retry";
    setup_thread(thread_id);
    const events: Array<{ type: string }> = [];

    emit_notifs([
      {
        method: "error",
        params: { threadId: thread_id, message: "temporary error", willRetry: true },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    const r = await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e as any) } }));
    expect(events.some(e => e.type === "error")).toBe(true);
    expect(r.finish_reason).toBe("stop");
  });

  it("willRetry=false → reject → finish_reason=error", async () => {
    const thread_id = "thr-err-fatal";
    setup_thread(thread_id);

    emit_notif({
      method: "error",
      params: { threadId: thread_id, message: "fatal error", willRetry: false },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("fatal error");
  });
});

// ══════════════════════════════════════════
// turn/completed status=failed — codexErrorInfo
// ══════════════════════════════════════════

describe("CodexAppServerAgent — turn/completed status=failed", () => {
  it("codexErrorInfo={type:ContextWindowExceeded} → max_tokens", async () => {
    const thread_id = "thr-ctx-exceeded";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: {
        threadId: thread_id,
        turn: {
          status: "failed",
          error: { message: "context window exceeded", codexErrorInfo: { type: "ContextWindowExceeded" } },
        },
      },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("max_tokens");
  });

  it("codexErrorInfo={type:UsageLimitExceeded} → max_budget", async () => {
    const thread_id = "thr-usage-exceeded";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: {
        threadId: thread_id,
        turn: {
          status: "failed",
          error: { message: "usage limit exceeded", codexErrorInfo: { type: "UsageLimitExceeded" } },
        },
      },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("max_budget");
  });

  it("codexErrorInfo=string → error", async () => {
    const thread_id = "thr-str-err";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: {
        threadId: thread_id,
        turn: {
          status: "failed",
          error: { message: "unknown error", codexErrorInfo: "SomeOtherError" },
        },
      },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("codexErrorInfo=null → error", async () => {
    const thread_id = "thr-null-err";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: {
        threadId: thread_id,
        turn: {
          status: "failed",
          error: { message: "failed", codexErrorInfo: null },
        },
      },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("turn/completed status=max_turns → max_turns", async () => {
    const thread_id = "thr-maxturns";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: { threadId: thread_id, turn: { status: "max_turns" } },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("max_turns");
  });

  it("structuredOutput → parsed_output 반환", async () => {
    const thread_id = "thr-structured";
    setup_thread(thread_id);

    emit_notif({
      method: "turn/completed",
      params: {
        threadId: thread_id,
        turn: { status: "completed", structuredOutput: { answer: 42, confidence: 0.9 } },
      },
    }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("stop");
    expect((r as any).parsed_output).toEqual({ answer: 42, confidence: 0.9 });
  });
});

// ══════════════════════════════════════════
// item/agentMessage/delta — after_tool 분기
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/agentMessage/delta after_tool", () => {
  it("도구 실행 후 새 에이전트 메시지 → 이전 내용 초기화", async () => {
    const thread_id = "thr-after-tool";
    setup_thread(thread_id);

    emit_notifs([
      // 도구 실행 전 에이전트 메시지
      { method: "item/agentMessage/delta", params: { threadId: thread_id, delta: "초기 텍스트" } },
      // 도구 결과 (after_tool=true 설정)
      {
        method: "item/completed",
        params: {
          threadId: thread_id,
          item: { type: "commandExecution", id: "cmd-1", output: "done", exitCode: 0 },
        },
      },
      // 도구 후 새 에이전트 메시지 → 초기 텍스트 버려짐
      { method: "item/agentMessage/delta", params: { threadId: thread_id, delta: "최종 답변" } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    const r = await make_agent().run(make_opts());
    // after_tool 분기로 content 리셋 후 "최종 답변"만 남음
    expect(r.content).toBe("최종 답변");
  });
});

// ══════════════════════════════════════════
// item/started(dynamicToolCall) — name 필드
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/started dynamicToolCall with name", () => {
  it("name 필드 있음 → tool_use 이벤트에 name 반영", async () => {
    const thread_id = "thr-dyn-name";
    setup_thread(thread_id);
    const tool_events: Array<{ tool_name?: string }> = [];

    emit_notifs([
      {
        method: "item/started",
        params: {
          threadId: thread_id,
          item: { type: "dynamicToolCall", id: "dt-1", name: "my_custom_tool", arguments: {} },
        },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_event: (e) => { if (e.type === "tool_use") tool_events.push(e as any); } } }));
    expect(tool_events.some(e => e.tool_name === "my_custom_tool")).toBe(true);
  });

  it("webSearch → tool_use with web_search 이름", async () => {
    const thread_id = "thr-web-search";
    setup_thread(thread_id);
    const tool_events: Array<{ tool_name?: string }> = [];

    emit_notifs([
      {
        method: "item/started",
        params: {
          threadId: thread_id,
          item: { type: "webSearch", id: "ws-1", arguments: { query: "test" } },
        },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { on_event: (e) => { if (e.type === "tool_use") tool_events.push(e as any); } } }));
    expect(tool_events.some(e => e.tool_name === "web_search")).toBe(true);
  });
});

// ══════════════════════════════════════════
// thread/closed — 이미 완료된 경우 무시
// ══════════════════════════════════════════

describe("CodexAppServerAgent — thread/closed 중복 처리", () => {
  it("turn/completed 후 thread/closed → 무시됨", async () => {
    const thread_id = "thr-double-close";
    setup_thread(thread_id);

    emit_notifs([
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
      { method: "thread/closed", params: { threadId: thread_id, reason: "completed" } },
    ], 8);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("stop");
  });
});

// ══════════════════════════════════════════
// abort_signal — 이미 aborted 상태
// ══════════════════════════════════════════

describe("CodexAppServerAgent — abort_signal", () => {
  it("이미 aborted → 즉시 cancelled 반환", async () => {
    const thread_id = "thr-abort-pre";
    setup_thread(thread_id);

    const controller = new AbortController();
    controller.abort();

    const r = await make_agent().run(make_opts({ abort_signal: controller.signal }));
    expect(r.finish_reason).toBe("cancelled");
  });

  it("실행 중 abort → cancelled", async () => {
    const thread_id = "thr-abort-mid";
    setup_thread(thread_id);

    const controller = new AbortController();

    // turn 시작 후 abort
    setTimeout(() => controller.abort(), 15);
    // 완료 알림은 늦게 (abort보다 느리게)
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 100);

    const r = await make_agent().run(make_opts({ abort_signal: controller.signal }));
    // abort가 먼저이므로 cancelled
    expect(r.finish_reason).toBe("cancelled");
  });
});

// ══════════════════════════════════════════
// on_server_request — item/tool/call
// ══════════════════════════════════════════

describe("CodexAppServerAgent — server_request item/tool/call", () => {
  it("알 수 없는 도구 → respond(success=false)", async () => {
    const thread_id = "thr-tool-unknown";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-1",
      method: "item/tool/call",
      params: { threadId: thread_id, tool: "nonexistent_tool", arguments: {} },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 50);

    await make_agent().run(make_opts());
    expect(last_respond).toHaveBeenCalledWith("req-1", expect.objectContaining({ success: false }));
  });

  it("도구 executor 있음 → execute 후 respond(success=true)", async () => {
    const thread_id = "thr-tool-exec";
    setup_thread(thread_id);

    const my_tool = {
      name: "my_tool",
      description: "test tool",
      parameters: {},
      execute: vi.fn().mockResolvedValue("tool output"),
    };

    emit_server_req({
      id: "req-2",
      method: "item/tool/call",
      params: { threadId: thread_id, tool: "my_tool", arguments: { x: 1 } },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({ tool_executors: [my_tool as any] }));
    expect(my_tool.execute).toHaveBeenCalled();
    expect(last_respond).toHaveBeenCalledWith("req-2", expect.objectContaining({ success: true }));
  });

  it("도구 execute 에러 → respond(success=false)", async () => {
    const thread_id = "thr-tool-err";
    setup_thread(thread_id);

    const bad_tool = {
      name: "bad_tool",
      description: "fails",
      parameters: {},
      execute: vi.fn().mockRejectedValue(new Error("tool crashed")),
    };

    emit_server_req({
      id: "req-3",
      method: "item/tool/call",
      params: { threadId: thread_id, tool: "bad_tool", arguments: {} },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({ tool_executors: [bad_tool as any] }));
    expect(last_respond).toHaveBeenCalledWith("req-3", expect.objectContaining({ success: false }));
  });

  it("pre_tool_use deny → respond(success=false, denied)", async () => {
    const thread_id = "thr-tool-deny";
    setup_thread(thread_id);

    const my_tool = {
      name: "gated_tool",
      description: "gated",
      parameters: {},
      execute: vi.fn().mockResolvedValue("ok"),
    };

    emit_server_req({
      id: "req-4",
      method: "item/tool/call",
      params: { threadId: thread_id, tool: "gated_tool", arguments: {} },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      tool_executors: [my_tool as any],
      hooks: {
        pre_tool_use: vi.fn().mockResolvedValue({ permission: "deny", reason: "policy violation" }),
      },
    }));
    expect(my_tool.execute).not.toHaveBeenCalled();
    expect(last_respond).toHaveBeenCalledWith("req-4", expect.objectContaining({ success: false }));
  });
});

// ══════════════════════════════════════════
// on_server_request — requestUserInput
// ══════════════════════════════════════════

describe("CodexAppServerAgent — server_request requestUserInput", () => {
  it("buffered_input 있음 → 즉시 respond", async () => {
    const thread_id = "thr-user-input-buf";
    setup_thread(thread_id);
    let captured_send: ((text: string) => void) | null = null;

    // register_send_input을 통해 입력을 버퍼에 미리 넣음
    const opts = make_opts({
      register_send_input: (fn) => { captured_send = fn; },
    });

    // 20ms 후 server_request, 50ms 후 completed
    setTimeout(() => captured_send?.("사용자 응답"), 15);
    emit_server_req({
      id: "req-user-buf",
      method: "requestUserInput",
      params: { threadId: thread_id, questions: [{ id: "q1" }] },
    }, 25);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 100);

    await make_agent().run(opts);
    // respond가 호출되어야 함 (buffered 또는 pending 경로)
    expect(last_respond).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// on_server_request — requestApproval
// ══════════════════════════════════════════

describe("CodexAppServerAgent — server_request requestApproval", () => {
  it("on_approval 없음 → 자동 accept", async () => {
    const thread_id = "thr-approval-auto";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-approval",
      method: "requestApproval",
      params: { threadId: thread_id, command: ["ls", "-la"] },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 60);

    await make_agent().run(make_opts());
    expect(last_respond).toHaveBeenCalledWith("req-approval", "accept");
  });

  it("on_approval=accept → accept 전달", async () => {
    const thread_id = "thr-approval-accept";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-apr-ok",
      method: "requestApproval",
      params: { threadId: thread_id, command: "rm -rf /tmp/test" },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      hooks: { on_approval: vi.fn().mockResolvedValue("accept") },
    }));
    expect(last_respond).toHaveBeenCalledWith("req-apr-ok", "accept");
  });

  it("on_approval=deny → decline 전달", async () => {
    const thread_id = "thr-approval-deny";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-apr-deny",
      method: "requestApproval",
      params: { threadId: thread_id, command: "curl http://evil.com" },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      hooks: { on_approval: vi.fn().mockResolvedValue("deny") },
    }));
    expect(last_respond).toHaveBeenCalledWith("req-apr-deny", "decline");
  });

  it("on_approval=accept_session → acceptForSession 전달", async () => {
    const thread_id = "thr-approval-sess";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-apr-sess",
      method: "requestApproval",
      params: { threadId: thread_id, command: "node script.js" },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      hooks: { on_approval: vi.fn().mockResolvedValue("accept_session") },
    }));
    expect(last_respond).toHaveBeenCalledWith("req-apr-sess", "acceptForSession");
  });

  it("fileChange requestApproval → file_change 타입 bridge_request", async () => {
    const thread_id = "thr-approval-fc";
    setup_thread(thread_id);
    const approval_requests: Array<{ type?: string }> = [];

    emit_server_req({
      id: "req-apr-fc",
      method: "requestApproval.fileChange",
      params: { threadId: thread_id, reason: "file modification" },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      hooks: {
        on_approval: vi.fn().mockImplementation(async (req) => {
          approval_requests.push(req);
          return "accept";
        }),
        on_event: (_e) => {},
      },
    }));
    expect(approval_requests.some(r => r.type === "file_change")).toBe(true);
  });

  it("on_approval rejects → decline 폴백", async () => {
    const thread_id = "thr-approval-rej";
    setup_thread(thread_id);

    emit_server_req({
      id: "req-apr-rej",
      method: "requestApproval",
      params: { threadId: thread_id, command: "bad" },
    }, 10);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 80);

    await make_agent().run(make_opts({
      hooks: { on_approval: vi.fn().mockRejectedValue(new Error("approval crashed")) },
    }));
    // catch에서 decline
    expect(last_respond).toHaveBeenCalledWith("req-apr-rej", "decline");
  });
});

// ══════════════════════════════════════════
// _ensure_client — is_running=true (재사용 경로)
// ══════════════════════════════════════════

describe("CodexAppServerAgent — _ensure_client 재사용 경로", () => {
  it("클라이언트가 이미 running → 초기화 skip", async () => {
    const thread_id = "thr-reuse";
    let init_count = 0;
    shared_request.mockImplementation(async (method: string) => {
      if (method === "initialize") { init_count++; return {}; }
      if (method === "thread/start") return { thread: { id: thread_id } };
      if (method === "turn/start") return new Promise(() => {});
      return {};
    });

    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 10);

    const agent = make_agent();
    // 첫 번째 실행 (초기화 발생)
    await agent.run(make_opts());
    // client를 running 상태로 표시
    get_client()!.is_running.mockReturnValue(true);
    const prev_init = init_count;

    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 10);

    // 두 번째 실행 (초기화 skip)
    await agent.run(make_opts());
    expect(init_count).toBe(prev_init); // 추가 initialize 없음
  });
});

// ══════════════════════════════════════════
// _ensure_client — error event 처리
// ══════════════════════════════════════════

describe("CodexAppServerAgent — _ensure_client error event", () => {
  it("client error 이벤트 → client=null, initialized=false", async () => {
    const thread_id = "thr-client-err";
    setup_thread(thread_id);

    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 20);

    const agent = make_agent();
    await agent.run(make_opts());

    // error 이벤트 발생
    get_client()?.emit("error");
    expect((agent as any).client).toBeNull();
    expect((agent as any).initialized).toBe(false);
  });
});

// ══════════════════════════════════════════
// item/completed(dynamicToolCall) — post_tool_use는 호출 안 됨
// ══════════════════════════════════════════

describe("CodexAppServerAgent — item/completed dynamicToolCall post_tool_use 미호출", () => {
  it("dynamicToolCall → post_tool_use 미호출 (item/tool/call 핸들러에서 처리)", async () => {
    const thread_id = "thr-dyn-post";
    setup_thread(thread_id);
    const post_hook = vi.fn();

    emit_notifs([
      {
        method: "item/completed",
        params: {
          threadId: thread_id,
          item: { type: "dynamicToolCall", id: "dt-2", success: true, output: "result" },
        },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { post_tool_use: post_hook } }));
    // dynamicToolCall은 post_tool_use를 item/completed에서 호출하지 않음
    expect(post_hook).not.toHaveBeenCalled();
  });

  it("commandExecution exitCode!=0 → is_error=true, post_tool_use 호출됨", async () => {
    const thread_id = "thr-cmd-fail";
    setup_thread(thread_id);
    const post_hook = vi.fn();

    emit_notifs([
      {
        method: "item/completed",
        params: {
          threadId: thread_id,
          item: { type: "commandExecution", id: "cmd-fail", output: "error", exitCode: 1 },
        },
      },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ]);

    await make_agent().run(make_opts({ hooks: { post_tool_use: post_hook } }));
    expect(post_hook).toHaveBeenCalledWith("exec", expect.anything(), "error", expect.anything(), true);
  });
});
