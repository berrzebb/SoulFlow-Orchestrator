/**
 * PtyTransport — 미커버 분기 커버리지.
 * - send: stdin_mode="close" → pty.end, "keep" → pty.write
 * - remove_session: subscriptions dispose
 * - shutdown: 모든 connection 정리
 * - ensure_connection: onExit handler → flush remaining
 * - emit_output: handler 예외 catch
 * - wait_for_terminal: crash path (pty exits without terminal msg)
 * - wait_for_terminal: pty not found → no-op dispose
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── NdjsonParser mock ─────────────────────────────────────────────────────────

const mock_feed = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mock_flush = vi.hoisted(() => vi.fn().mockReturnValue([]));

vi.mock("@src/agent/pty/ndjson-parser.js", () => ({
  NdjsonParser: vi.fn().mockImplementation(function () {
    this.feed = mock_feed;
    this.flush = mock_flush;
  }),
}));

import { PtyTransport } from "@src/agent/pty/pty-transport.js";

// ─── mock Pty 헬퍼 ─────────────────────────────────────────────────────────────

function make_pty() {
  const data_cbs = new Set<(data: string) => void>();
  const exit_cbs = new Set<(e: { exitCode: number }) => void>();

  const pty = {
    pid: "test-pty",
    write: vi.fn(),
    end: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      data_cbs.add(cb);
      return { dispose: () => data_cbs.delete(cb) };
    }),
    onExit: vi.fn((cb: (e: { exitCode: number }) => void) => {
      exit_cbs.add(cb);
      return { dispose: () => exit_cbs.delete(cb) };
    }),
    kill: vi.fn(),
    resize: vi.fn(),
    emit_data: (chunk: string) => { for (const cb of data_cbs) cb(chunk); },
    emit_exit: (code = 0) => { for (const cb of exit_cbs) cb({ exitCode: code }); },
  };
  return pty;
}

function make_pool(pty_instance: ReturnType<typeof make_pty> | null = null) {
  return {
    ensure_running: vi.fn().mockReturnValue(pty_instance ?? make_pty()),
    touch: vi.fn(),
    get: vi.fn().mockReturnValue(pty_instance),
    remove: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function make_adapter(stdin_mode: "close" | "keep" = "close") {
  return {
    stdin_mode,
    format_input: vi.fn().mockReturnValue("formatted-input"),
    parse_output: vi.fn(),
    build_args: vi.fn().mockReturnValue([]),
  } as any;
}

function make_transport(stdin_mode: "close" | "keep" = "close", pool?: ReturnType<typeof make_pool>) {
  const pty = make_pty();
  const p = pool ?? make_pool(pty);
  const transport = new PtyTransport({
    pool: p as any,
    adapter: make_adapter(stdin_mode),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  });
  return { transport, pty, pool: p };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock_feed.mockReturnValue([]);
  mock_flush.mockReturnValue([]);
});

// ══════════════════════════════════════════════════════════
// send — stdin_mode 분기
// ══════════════════════════════════════════════════════════

describe("PtyTransport — send (stdin_mode)", () => {
  it("stdin_mode='close' → pty.end(payload) 호출", async () => {
    const { transport, pty, pool } = make_transport("close");

    // complete 메시지 즉시 emit하여 wait_for_terminal 해소
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const complete_msg = { type: "complete" as const, reply: "done" };
    const send_promise = transport.send("sess1", { task: "t" } as any, {} as any);

    // output handler에 complete 메시지 주입
    transport["emit_output"]("sess1", complete_msg);
    const result = await send_promise;

    expect(pty.end).toHaveBeenCalledWith("formatted-input");
    expect(result.type).toBe("complete");
  });

  it("stdin_mode='keep' → pty.write(payload) 호출", async () => {
    const { transport, pty, pool } = make_transport("keep");
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const send_promise = transport.send("sess2", { task: "t" } as any, {} as any);
    transport["emit_output"]("sess2", { type: "complete" as const, reply: "done" });
    await send_promise;

    expect(pty.write).toHaveBeenCalledWith("formatted-input");
  });
});

// ══════════════════════════════════════════════════════════
// on_output / dispose
// ══════════════════════════════════════════════════════════

describe("PtyTransport — on_output", () => {
  it("on_output 등록 → emit_output 시 핸들러 호출", () => {
    const { transport } = make_transport();
    const handler = vi.fn();
    transport.on_output(handler);
    transport["emit_output"]("sess", { type: "complete", reply: "r" } as any);
    expect(handler).toHaveBeenCalledWith("sess", expect.objectContaining({ type: "complete" }));
  });

  it("on_output dispose → 이후 emit 무시", () => {
    const { transport } = make_transport();
    const handler = vi.fn();
    const { dispose } = transport.on_output(handler);
    dispose();
    transport["emit_output"]("sess", { type: "complete", reply: "r" } as any);
    expect(handler).not.toHaveBeenCalled();
  });

  it("emit_output: handler 예외 → 다음 handler는 정상 호출 (catch)", () => {
    const { transport } = make_transport();
    const throwing_handler = vi.fn().mockImplementation(() => { throw new Error("handler error"); });
    const normal_handler = vi.fn();
    transport.on_output(throwing_handler);
    transport.on_output(normal_handler);
    // 예외가 전파되면 안 됨
    expect(() => transport["emit_output"]("s", { type: "complete" } as any)).not.toThrow();
    expect(normal_handler).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════════════════════
// list_sessions / remove_session / shutdown
// ══════════════════════════════════════════════════════════

describe("PtyTransport — session management", () => {
  it("list_sessions → 등록된 session key 반환", async () => {
    const { transport, pty, pool } = make_transport();
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    // ensure_connection 호출 (send를 통해)
    const p = transport.send("sess-a", { task: "t" } as any, {} as any);
    transport["emit_output"]("sess-a", { type: "complete" } as any);
    await p;

    expect(transport.list_sessions()).toContain("sess-a");
  });

  it("remove_session: connection 있음 → subscriptions dispose + pool.remove", async () => {
    const { transport, pty, pool } = make_transport();
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    // ensure_connection 호출
    const p = transport.send("sess-b", { task: "t" } as any, {} as any);
    transport["emit_output"]("sess-b", { type: "complete" } as any);
    await p;

    await transport.remove_session("sess-b");
    expect(pool.remove).toHaveBeenCalledWith("sess-b");
    expect(transport.list_sessions()).not.toContain("sess-b");
  });

  it("remove_session: connection 없음 → pool.remove만 호출", async () => {
    const { transport, pool } = make_transport();
    await transport.remove_session("nonexistent");
    expect(pool.remove).toHaveBeenCalledWith("nonexistent");
  });

  it("shutdown → 모든 connection 정리 + pool.shutdown", async () => {
    const { transport, pty, pool } = make_transport();
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const p = transport.send("sess-c", { task: "t" } as any, {} as any);
    transport["emit_output"]("sess-c", { type: "complete" } as any);
    await p;

    await transport.shutdown();
    expect(pool.shutdown).toHaveBeenCalledOnce();
    expect(transport.list_sessions()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════
// ensure_connection: onExit handler → flush remaining
// ══════════════════════════════════════════════════════════

describe("PtyTransport — ensure_connection onExit", () => {
  it("pty exit → parser.flush() 호출 + connection 삭제", async () => {
    const { transport, pty, pool } = make_transport();
    const flushed_msg = { type: "complete" as const, reply: "flushed" };
    mock_flush.mockReturnValue([flushed_msg]);
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const output_handler = vi.fn();
    transport.on_output(output_handler);

    // ensure_connection 실행 (send → wait_for_terminal 시작)
    const p = transport.send("sess-d", { task: "t" } as any, {} as any);

    // pty exit 발생 → onExit 핸들러 → flush → emit_output
    pty.emit_exit(0);

    const result = await p;
    expect(mock_flush).toHaveBeenCalled();
    // flushed_msg가 emit됨
    expect(output_handler).toHaveBeenCalledWith("sess-d", flushed_msg);
  });
});

// ══════════════════════════════════════════════════════════
// wait_for_terminal: crash path
// ══════════════════════════════════════════════════════════

describe("PtyTransport — wait_for_terminal crash path", () => {
  it("pty exits without complete/error → crash 메시지 반환", async () => {
    const { transport, pty, pool } = make_transport();
    mock_flush.mockReturnValue([]); // flush → nothing
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const p = transport.send("sess-crash", { task: "t" } as any, {} as any);

    // pty exit, flush 없음 → 50ms 후 crash
    pty.emit_exit(1);

    // crash 해소를 위해 충분히 기다림
    await new Promise((r) => setTimeout(r, 100));
    const result = await p;

    expect(result.type).toBe("error");
    expect((result as any).code).toBe("crash");
  });

  it("pty not found (pool.get=null) → no-op dispose", async () => {
    const pty = make_pty();
    const pool = make_pool(null); // pool.get = null
    pool.ensure_running.mockReturnValue(pty);
    const transport = new PtyTransport({
      pool: pool as any,
      adapter: make_adapter("close"),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    });

    const p = transport.send("sess-null", { task: "t" } as any, {} as any);
    // complete 메시지로 해소
    transport["emit_output"]("sess-null", { type: "complete" as const, reply: "ok" });
    const result = await p;
    expect(result.type).toBe("complete");
  });
});

// ══════════════════════════════════════════════════════════
// onData → emit_output (ensure_connection data handler)
// ══════════════════════════════════════════════════════════

describe("PtyTransport — onData → emit_output", () => {
  it("pty data → parser.feed → emit_output for each msg", async () => {
    const { transport, pty, pool } = make_transport();
    const msg1 = { type: "partial" as const, chunk: "hello" };
    const msg2 = { type: "complete" as const, reply: "done" };
    mock_feed.mockReturnValueOnce([msg1, msg2]);
    pool.ensure_running.mockReturnValue(pty);
    pool.get.mockReturnValue(pty);

    const output_handler = vi.fn();
    transport.on_output(output_handler);

    const p = transport.send("sess-data", { task: "t" } as any, {} as any);
    // pty data 발생 → feed → [msg1, msg2] → emit_output
    pty.emit_data("chunk");

    await p;
    expect(output_handler).toHaveBeenCalledWith("sess-data", msg1);
    expect(output_handler).toHaveBeenCalledWith("sess-data", msg2);
  });
});
