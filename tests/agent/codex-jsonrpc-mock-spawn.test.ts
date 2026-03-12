/**
 * CodexJsonRpcClient — start/stop/request/notify/respond 프로세스 lifecycle 테스트.
 * vi.mock으로 node:child_process.spawn 대체.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ── spawn mock ─────────────────────────────────────────
const { mock_spawn } = vi.hoisted(() => ({ mock_spawn: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: mock_spawn,
}));

// ── MockProcess ────────────────────────────────────────
class MockProcess extends EventEmitter {
  stdin = { writable: true as boolean, write: vi.fn().mockReturnValue(true) };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn(() => { this.killed = true; });
}

// ── import after mock ─────────────────────────────────
import { CodexJsonRpcClient } from "@src/agent/backends/codex-jsonrpc.js";

function make_client(opts: { timeout_ms?: number } = {}): CodexJsonRpcClient {
  return new CodexJsonRpcClient({ command: "codex", args: ["--server"], request_timeout_ms: opts.timeout_ms ?? 5000 });
}

function make_mock_process(): MockProcess {
  const proc = new MockProcess();
  mock_spawn.mockReturnValueOnce(proc as unknown as ReturnType<typeof mock_spawn>);
  return proc;
}

beforeEach(() => {
  mock_spawn.mockReset();
});

// ══════════════════════════════════════════
// start / is_running
// ══════════════════════════════════════════

describe("CodexJsonRpcClient — start / is_running", () => {
  it("start() → spawn 호출 + is_running() = true", () => {
    make_mock_process();
    const client = make_client();
    client.start();
    expect(mock_spawn).toHaveBeenCalledWith("codex", ["--server"], expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
    expect(client.is_running()).toBe(true);
  });

  it("start() 중복 → spawn 1번만 호출", () => {
    make_mock_process();
    const client = make_client();
    client.start();
    client.start();
    expect(mock_spawn).toHaveBeenCalledTimes(1);
  });

  it("stdout data → _on_data 처리 → notification 이벤트", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    const handler = vi.fn();
    client.on("notification", handler);

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "ping" }) + "\n"));
    expect(handler).toHaveBeenCalledWith({ method: "ping", params: {} });
  });

  it("stderr data → 'stderr' 이벤트 emit", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    const handler = vi.fn();
    client.on("stderr", handler);
    proc.stderr.emit("data", Buffer.from("some error output"));
    expect(handler).toHaveBeenCalledWith("some error output");
  });

  it("프로세스 exit → 'exit' emit + pending reject + is_running=false", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    const exit_handler = vi.fn();
    client.on("exit", exit_handler);

    const reject_fn = vi.fn();
    (client as any).pending.set("r1", {
      resolve: vi.fn(), reject: reject_fn, timer: setTimeout(() => {}, 10000),
    });

    proc.emit("exit", 1);
    expect(exit_handler).toHaveBeenCalledWith(1);
    expect(reject_fn).toHaveBeenCalled();
    expect(client.is_running()).toBe(false);
  });

  it("프로세스 error → 'error' emit + pending reject", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    const error_handler = vi.fn();
    client.on("error", error_handler);

    const reject_fn = vi.fn();
    (client as any).pending.set("r2", {
      resolve: vi.fn(), reject: reject_fn, timer: setTimeout(() => {}, 10000),
    });

    proc.emit("error", new Error("ENOENT"));
    expect(error_handler).toHaveBeenCalled();
    expect(reject_fn).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// stop
// ══════════════════════════════════════════

describe("CodexJsonRpcClient — stop (process running)", () => {
  it("stop() → process.kill(SIGTERM) + is_running=false", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();
    expect(client.is_running()).toBe(true);

    client.stop();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(client.is_running()).toBe(false);
  });
});

// ══════════════════════════════════════════
// request
// ══════════════════════════════════════════

describe("CodexJsonRpcClient — request()", () => {
  it("request() — process 없음 → codex_process_not_running 에러", async () => {
    const client = make_client();
    await expect(client.request("test")).rejects.toThrow("codex_process_not_running");
  });

  it("request() — stdin에 JSON-RPC 메시지 쓰기 → 응답 시 resolve", async () => {
    const proc = make_mock_process();
    const client = make_client({ timeout_ms: 1000 });
    client.start();

    const req_promise = client.request("do_thing", { x: 1 });

    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(written.trim()) as { id: string; method: string; params?: unknown };
    expect(msg.method).toBe("do_thing");
    expect(msg.params).toEqual({ x: 1 });

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) + "\n"));

    const result = await req_promise;
    expect(result).toEqual({ ok: true });
  });

  it("request() — timeout → codex_request_timeout 에러", async () => {
    make_mock_process();
    const client = make_client({ timeout_ms: 50 });
    client.start();
    await expect(client.request("slow")).rejects.toThrow("codex_request_timeout:slow");
  });

  it("request() — 에러 응답 → reject with codex_rpc_error", async () => {
    const proc = make_mock_process();
    const client = make_client({ timeout_ms: 1000 });
    client.start();

    const req_promise = client.request("fail_thing");

    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(written.trim()) as { id: string };

    proc.stdout.emit("data", Buffer.from(JSON.stringify({
      jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" },
    }) + "\n"));

    await expect(req_promise).rejects.toThrow("codex_rpc_error:-32601:Method not found");
  });
});

// ══════════════════════════════════════════
// notify
// ══════════════════════════════════════════

describe("CodexJsonRpcClient — notify()", () => {
  it("notify() — stdin에 id 없는 notification 쓰기", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    client.notify("heartbeat", { ts: 999 });

    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(msg.method).toBe("heartbeat");
    expect(msg.params).toEqual({ ts: 999 });
    expect(msg.id).toBeUndefined();
  });

  it("notify() — params 없이 호출", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    client.notify("simple");
    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(written.trim()) as Record<string, unknown>;
    expect(msg.params).toBeUndefined();
  });

  it("notify() — process 없으면 no-op (예외 없음)", () => {
    const client = make_client();
    expect(() => client.notify("x")).not.toThrow();
  });
});

// ══════════════════════════════════════════
// respond
// ══════════════════════════════════════════

describe("CodexJsonRpcClient — respond()", () => {
  it("respond() — 서버 요청에 결과 응답 전송", () => {
    const proc = make_mock_process();
    const client = make_client();
    client.start();

    client.respond("srv-1", { status: "done" });

    const written = (proc.stdin.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const msg = JSON.parse(written.trim()) as { id: string; result: unknown };
    expect(msg.id).toBe("srv-1");
    expect(msg.result).toEqual({ status: "done" });
  });

  it("respond() — process 없으면 no-op (예외 없음)", () => {
    const client = make_client();
    expect(() => client.respond("x", {})).not.toThrow();
  });
});
