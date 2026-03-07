import { describe, it, expect, vi } from "vitest";
import { CodexJsonRpcClient } from "@src/agent/backends/codex-jsonrpc.js";

/** _on_data는 private이므로 프로토타입에서 접근. */
function feed(client: CodexJsonRpcClient, chunk: string): void {
  (client as any)._on_data(chunk);
}

function make_client(): CodexJsonRpcClient {
  return new CodexJsonRpcClient({ command: "echo", args: [], request_timeout_ms: 1000 });
}

describe("CodexJsonRpcClient parsing", () => {
  it("emits notification for method-only messages", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("notification", handler);

    feed(client, JSON.stringify({ jsonrpc: "2.0", method: "progress", params: { pct: 50 } }) + "\n");

    expect(handler).toHaveBeenCalledWith({
      method: "progress",
      params: { pct: 50 },
    });
  });

  it("emits server_request for id+method messages", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("server_request", handler);

    feed(client, JSON.stringify({ jsonrpc: "2.0", id: "srv1", method: "exec_tool", params: { tool: "ls" } }) + "\n");

    expect(handler).toHaveBeenCalledWith({
      id: "srv1",
      method: "exec_tool",
      params: { tool: "ls" },
    });
  });

  it("emits unknown_message for unrecognized formats", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("unknown_message", handler);

    feed(client, JSON.stringify({ jsonrpc: "2.0", id: "x" }) + "\n");
    expect(handler).toHaveBeenCalled();
  });

  it("handles chunked input across multiple feeds", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("notification", handler);

    const msg = JSON.stringify({ jsonrpc: "2.0", method: "ping" });
    feed(client, msg.slice(0, 10));
    expect(handler).not.toHaveBeenCalled();

    feed(client, msg.slice(10) + "\n");
    expect(handler).toHaveBeenCalledWith({ method: "ping", params: {} });
  });

  it("handles multiple messages in one chunk", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("notification", handler);

    const msg1 = JSON.stringify({ jsonrpc: "2.0", method: "a" });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", method: "b" });
    feed(client, msg1 + "\n" + msg2 + "\n");

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("skips empty lines", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("notification", handler);

    feed(client, "\n\n" + JSON.stringify({ jsonrpc: "2.0", method: "c" }) + "\n\n");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits parse_error for invalid JSON", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("parse_error", handler);

    feed(client, "not json\n");
    expect(handler).toHaveBeenCalledWith("not json");
  });

  it("emits parse_error and clears buffer on overflow", () => {
    const client = make_client();
    const handler = vi.fn();
    client.on("parse_error", handler);

    // 10MB+ without newline
    feed(client, "x".repeat(10_000_001));
    expect(handler).toHaveBeenCalled();
    const arg = handler.mock.calls[0][0] as string;
    expect(arg).toContain("buffer_overflow");
  });
});

describe("CodexJsonRpcClient response matching", () => {
  it("resolves pending request on matching response", async () => {
    const client = make_client();
    // Manually add a pending request
    const promise = new Promise<unknown>((resolve, reject) => {
      (client as any).pending.set("req1", {
        resolve,
        reject,
        timer: setTimeout(() => {}, 10000),
      });
    });

    feed(client, JSON.stringify({ jsonrpc: "2.0", id: "req1", result: { data: "ok" } }) + "\n");

    const result = await promise;
    expect(result).toEqual({ data: "ok" });
  });

  it("rejects pending request on error response", async () => {
    const client = make_client();
    const promise = new Promise<unknown>((resolve, reject) => {
      (client as any).pending.set("req2", {
        resolve,
        reject,
        timer: setTimeout(() => {}, 10000),
      });
    });

    feed(client, JSON.stringify({
      jsonrpc: "2.0", id: "req2",
      error: { code: -1, message: "fail" },
    }) + "\n");

    await expect(promise).rejects.toThrow("codex_rpc_error:-1:fail");
  });
});

describe("CodexJsonRpcClient lifecycle", () => {
  it("is_running returns false before start", () => {
    const client = make_client();
    expect(client.is_running()).toBe(false);
  });

  it("stop rejects all pending requests", () => {
    const client = make_client();
    const rejects: Error[] = [];

    (client as any).pending.set("a", {
      resolve: () => {},
      reject: (e: Error) => rejects.push(e),
      timer: setTimeout(() => {}, 10000),
    });
    (client as any).pending.set("b", {
      resolve: () => {},
      reject: (e: Error) => rejects.push(e),
      timer: setTimeout(() => {}, 10000),
    });

    client.stop();
    expect(rejects).toHaveLength(2);
    expect(rejects[0].message).toContain("codex_client_stopped");
  });
});
