/**
 * CodexAppServerAgent — execFileSync + CodexJsonRpcClient mock 기반 커버리지.
 * 실제 Codex CLI 없이 is_available / run / stop 경로 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted: all mocks must be defined here ──────────────────────────────────────

const { mock_exec_file_sync, shared_request, get_client, ClientProxy } = vi.hoisted(() => {
  const mock_exec_file_sync = vi.fn();
  const shared_request = vi.fn();
  let _client: InstanceType<typeof ClientProxy> | null = null;

  // 최소한의 EventEmitter 구현 (node:events import 없이 vi.hoisted에서 사용 가능)
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
    emit(ev: string, ...a: unknown[]) { (this._h[ev] || []).forEach(fn => fn(...a)); return true; }
    removeListener(ev: string, fn: (...a: unknown[]) => void) { return this.off(ev, fn); }
  }

  class ClientProxy extends MinimalEmitter {
    is_running = vi.fn().mockReturnValue(false);
    start = vi.fn();
    stop = vi.fn();
    notify = vi.fn();
    request = shared_request;

    constructor(_config: unknown) {
      super();
      _client = this;
    }
  }

  const get_client = () => _client;

  return { mock_exec_file_sync, shared_request, get_client, ClientProxy };
});

vi.mock("node:child_process", () => ({ execFileSync: mock_exec_file_sync }));
vi.mock("@src/agent/backends/codex-jsonrpc.js", () => ({ CodexJsonRpcClient: ClientProxy }));

import { CodexAppServerAgent } from "@src/agent/backends/codex-appserver.agent.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";

// ── 헬퍼 ──────────────────────────────────────────────

function make_agent(config: Record<string, unknown> = {}) {
  return new CodexAppServerAgent({ cwd: "/tmp/test-cwd", request_timeout_ms: 10000, ...config } as any);
}

function make_opts(overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    task_id: "t-1",
    task: "do something",
    system_prompt: "You are helpful.",
    messages: [],
    cwd: "/tmp/test-cwd",
    ...overrides,
  };
}

function set_request_responses(responses: Array<unknown | Error>) {
  let call = 0;
  shared_request.mockImplementation(async (method: string) => {
    const resp = call < responses.length ? responses[call] : {};
    call++;
    if (resp instanceof Error) throw resp;
    return resp;
  });
}

function emit_notif(notif: { method: string; params: Record<string, unknown> }, delay = 10) {
  setTimeout(() => get_client()?.emit("notification", notif), delay);
}

function emit_notifs(notifs: Array<{ method: string; params: Record<string, unknown> }>, base = 10) {
  notifs.forEach((n, i) => emit_notif(n, base + i * base));
}

beforeEach(() => {
  vi.clearAllMocks();
  set_request_responses([{}, { thread: { id: "thread-default" } }]);
});

// ══════════════════════════════════════════
// is_available
// ══════════════════════════════════════════

describe("CodexAppServerAgent — is_available", () => {
  it("execFileSync 성공 → true", () => {
    mock_exec_file_sync.mockReturnValue(Buffer.from("1.0.0"));
    expect(make_agent().is_available()).toBe(true);
  });

  it("execFileSync 실패 → false", () => {
    mock_exec_file_sync.mockImplementation(() => { throw new Error("not found"); });
    expect(make_agent().is_available()).toBe(false);
  });

  it("id 기본값 = codex_appserver", () => {
    expect(make_agent().id).toBe("codex_appserver");
  });

  it("id 커스텀", () => {
    expect(make_agent({ id: "my-codex" }).id).toBe("my-codex");
  });

  it("native_tool_loop=true, supports_resume=true", () => {
    const a = make_agent();
    expect(a.native_tool_loop).toBe(true);
    expect(a.supports_resume).toBe(true);
  });
});

// ══════════════════════════════════════════
// stop()
// ══════════════════════════════════════════

describe("CodexAppServerAgent — stop()", () => {
  it("client 없으면 에러 없음", () => {
    expect(() => make_agent().stop()).not.toThrow();
  });

  it("client 있으면 stop() 호출 + null 처리", () => {
    const agent = make_agent();
    const stop_fn = vi.fn();
    (agent as any).client = { stop: stop_fn };
    (agent as any).initialized = true;
    agent.stop();
    expect(stop_fn).toHaveBeenCalled();
    expect((agent as any).client).toBeNull();
    expect((agent as any).initialized).toBe(false);
  });
});

// ══════════════════════════════════════════
// run() — cwd 없음
// ══════════════════════════════════════════

describe("CodexAppServerAgent — run() cwd 없음", () => {
  it("cwd 미설정 → error 반환", async () => {
    const agent = new CodexAppServerAgent({ request_timeout_ms: 5000 } as any);
    const r = await agent.run(make_opts({ cwd: undefined }));
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("cwd is required");
  });
});

// ══════════════════════════════════════════
// run() — 초기화 실패
// ══════════════════════════════════════════

describe("CodexAppServerAgent — run() 초기화 실패", () => {
  it("initialize 실패 → codex_init_failed", async () => {
    set_request_responses([new Error("init_timeout")]);
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("codex_init_failed");
  });

  it("thread_id 없음 → codex_no_thread_id", async () => {
    set_request_responses([{}, { thread: { id: "" } }]);
    const agent = make_agent();
    const r = await agent.run(make_opts());
    expect(r.finish_reason).toBe("error");
    expect(r.content).toContain("codex_no_thread_id");
  });
});

// ══════════════════════════════════════════
// run() — 성공 경로 (notification 기반)
// ══════════════════════════════════════════

describe("CodexAppServerAgent — run() 성공", () => {
  it("turn/completed status=completed → stop", async () => {
    const thread_id = "thr-ok";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const events: string[] = [];

    emit_notifs([
      { method: "turn/started", params: { threadId: thread_id, turn: { id: "turn-1" } } },
      { method: "item/agentMessage/delta", params: { threadId: thread_id, delta: "Result!" } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed", tokenUsage: { inputTokens: 10, outputTokens: 5 } } } },
    ], 8);

    const r = await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));

    expect(r.finish_reason).toBe("stop");
    expect(r.content).toBe("Result!");
    expect(r.usage?.prompt_tokens).toBe(10);
    expect(events).toContain("init");
    expect(events).toContain("content_delta");
    expect(events).toContain("complete");
  });

  it("turn/completed status=interrupted → cancelled", async () => {
    const thread_id = "thr-int";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "interrupted" } } }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("cancelled");
  });

  it("thread/closed → error", async () => {
    const thread_id = "thr-closed";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    emit_notif({ method: "thread/closed", params: { threadId: thread_id, reason: "error" } }, 10);

    const r = await make_agent().run(make_opts());
    expect(r.finish_reason).toBe("error");
  });

  it("item/started(commandExecution) → tool_use 이벤트 + tool_calls_count", async () => {
    const thread_id = "thr-cmd";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const events: string[] = [];

    emit_notifs([
      { method: "item/started", params: { threadId: thread_id, item: { type: "commandExecution", id: "cmd-1", arguments: { command: "ls" } } } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    const r = await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(r.tool_calls_count).toBe(1);
    expect(events).toContain("tool_use");
  });

  it("item/started(contextCompaction) → compact_boundary", async () => {
    const thread_id = "thr-compact";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const events: string[] = [];

    emit_notifs([
      { method: "item/started", params: { threadId: thread_id, item: { type: "contextCompaction" } } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("compact_boundary");
  });

  it("item/completed(commandExecution) → tool_result 이벤트", async () => {
    const thread_id = "thr-tool-result";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const events: string[] = [];

    emit_notifs([
      { method: "item/completed", params: { threadId: thread_id, item: { type: "commandExecution", id: "cmd-1", output: "ok\n", exitCode: 0 } } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("tool_result");
  });

  it("item/completed(dynamicToolCall) success=false → is_error=true", async () => {
    const thread_id = "thr-dyn-fail";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const tool_results: Array<{ is_error?: boolean }> = [];

    emit_notifs([
      { method: "item/completed", params: { threadId: thread_id, item: { type: "dynamicToolCall", id: "dt-1", success: false, output: "error" } } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    await make_agent().run(make_opts({
      hooks: { on_event: (e) => { if (e.type === "tool_result") tool_results.push(e as any); } },
    }));
    expect(tool_results.some(r => r.is_error)).toBe(true);
  });

  it("resume_session → thread/resume 호출", async () => {
    const thread_id = "thr-resume";
    const calls: string[] = [];
    shared_request.mockImplementation(async (method: string) => {
      calls.push(method);
      if (method === "initialize") return {};
      if (method === "thread/resume") return { thread: { id: thread_id } };
      return {};
    });

    emit_notif({ method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } }, 10);

    await make_agent().run(make_opts({
      resume_session: { session_id: "prev-id", backend: "codex_appserver", created_at: "" },
    }));

    expect(calls).toContain("thread/resume");
  });

  it("item/commandExecution/outputDelta → on_stream 호출", async () => {
    const thread_id = "thr-delta-out";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const chunks: string[] = [];

    emit_notifs([
      { method: "item/commandExecution/outputDelta", params: { threadId: thread_id, delta: "file1.txt" } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    await make_agent().run(make_opts({ hooks: { on_stream: async (c) => chunks.push(c) } }));
    expect(chunks.some(c => c.includes("file1.txt"))).toBe(true);
  });

  it("turn/diff/updated → content_delta 이벤트", async () => {
    const thread_id = "thr-diff";
    set_request_responses([{}, { thread: { id: thread_id } }]);
    const events: string[] = [];
    const diff = "diff --git a/file.ts b/file.ts\n+new line";

    emit_notifs([
      { method: "turn/diff/updated", params: { threadId: thread_id, diff } },
      { method: "turn/completed", params: { threadId: thread_id, turn: { status: "completed" } } },
    ], 8);

    await make_agent().run(make_opts({ hooks: { on_event: (e) => events.push(e.type) } }));
    expect(events).toContain("content_delta");
  });
});
