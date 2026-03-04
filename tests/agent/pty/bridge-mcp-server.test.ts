/**
 * bridge-mcp-server.mjs 테스트 — 실제 ToolBridgeServer + child_process spawn으로 E2E 검증.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { ToolBridgeServer } from "@src/agent/pty/tool-bridge-server.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { McpClientManager } from "@src/mcp/client-manager.ts";
import type { McpToolEntry, McpCallResult } from "@src/mcp/types.ts";
import { create_noop_logger } from "@helpers/harness.ts";

const BRIDGE_SCRIPT = resolve(import.meta.dirname, "../../../src/agent/pty/bridge-mcp-server.mjs");

const TOOLS: McpToolEntry[] = [
  { server_name: "ctx7", name: "context7_resolve", description: "Resolve docs", input_schema: { type: "object", properties: { library: { type: "string" } } } },
  { server_name: "web", name: "web_fetch", description: "Fetch URL", input_schema: { type: "object", properties: { url: { type: "string" } } } },
];

function create_mock_mcp(): McpClientManager {
  return {
    list_all_tools: vi.fn(() => TOOLS),
    call_tool: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: "text", text: `result for ${name}: ${JSON.stringify(args)}` }],
      is_error: false,
    } as McpCallResult)),
  } as unknown as McpClientManager;
}

/** bridge-mcp-server.mjs를 child process로 실행. */
function spawn_bridge(socket_path: string): ChildProcess {
  return spawn("node", [BRIDGE_SCRIPT], {
    env: { ...process.env, BRIDGE_SOCKET_PATH: socket_path },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** JSON-RPC 요청을 stdin에 쓰고 stdout에서 응답 수신. */
function send_request(proc: ChildProcess, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    rl.once("line", (line) => {
      try { resolve(JSON.parse(line)); }
      catch (e) { reject(e); }
    });
    proc.stdin!.write(JSON.stringify(request) + "\n");
    setTimeout(() => reject(new Error("bridge response timeout")), 10_000);
  });
}

describe("bridge-mcp-server.mjs", () => {
  let server: ToolBridgeServer;
  let proc: ChildProcess;

  afterEach(async () => {
    proc?.kill();
    await server?.stop();
  });

  it("initialize → 서버 정보 반환", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const socket_path = await server.start();

    proc = spawn_bridge(socket_path);
    const res = await send_request(proc, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
    });

    expect((res as any).result.serverInfo.name).toBe("orchestrator-bridge");
    expect((res as any).result.capabilities.tools).toBeDefined();
  });

  it("tools/list → 도구 목록 반환", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const socket_path = await server.start();

    proc = spawn_bridge(socket_path);

    // initialize 먼저
    await send_request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    // notifications/initialized (응답 없음)
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const res = await send_request(proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (res as any).result.tools;

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("context7_resolve");
    expect(tools[1].name).toBe("web_fetch");
  });

  it("tools/call → MCP 도구 실행 + 결과 반환", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const socket_path = await server.start();

    proc = spawn_bridge(socket_path);
    await send_request(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    const res = await send_request(proc, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "context7_resolve", arguments: { library: "react" } },
    });

    const result = (res as any).result;
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("context7_resolve");
    expect(result.content[0].text).toContain("react");
    expect(mcp.call_tool).toHaveBeenCalledWith("context7_resolve", { library: "react" });
  });

  it("BRIDGE_SOCKET_PATH 미설정 시 즉시 종료", async () => {
    const exit_code = await new Promise<number>((resolve) => {
      const p = spawn("node", [BRIDGE_SCRIPT], {
        env: { ...process.env, BRIDGE_SOCKET_PATH: undefined },
        stdio: ["pipe", "pipe", "pipe"],
      });
      p.on("exit", (code) => resolve(code ?? 1));
    });

    expect(exit_code).toBe(1);
  });

  it("잘못된 JSON → parse error 응답", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const socket_path = await server.start();

    proc = spawn_bridge(socket_path);

    const res = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
      rl.once("line", (line) => {
        try { resolve(JSON.parse(line)); }
        catch (e) { reject(e); }
      });
      proc.stdin!.write("not-valid-json\n");
      setTimeout(() => reject(new Error("timeout")), 5000);
    });

    expect((res as any).error.code).toBe(-32700);
  });
});
