import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolBridgeServer, type BridgeRequest, type BridgeResponse } from "@src/agent/pty/tool-bridge-server.ts";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { McpClientManager } from "@src/mcp/client-manager.ts";
import type { McpToolEntry, McpCallResult } from "@src/mcp/types.ts";
import { create_noop_logger } from "@helpers/harness.ts";

// ── Mock MCP ──

function create_mock_mcp(tools: McpToolEntry[] = [], call_result?: McpCallResult): McpClientManager {
  return {
    list_all_tools: vi.fn(() => tools),
    call_tool: vi.fn(async () => call_result ?? { content: [{ type: "text", text: "ok" }], is_error: false }),
  } as unknown as McpClientManager;
}

const SAMPLE_TOOLS: McpToolEntry[] = [
  { server_name: "ctx7", name: "context7_resolve", description: "Resolve docs", input_schema: { type: "object" } },
  { server_name: "web", name: "web_fetch", description: "Fetch URL", input_schema: { type: "object" } },
  { server_name: "web", name: "web_search", description: "Search web", input_schema: { type: "object" } },
];

// ── Helper: Unix 소켓 클라이언트 ──

function connect_and_request(socket_path: string, req: BridgeRequest): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(socket_path, () => {
      socket.write(JSON.stringify(req) + "\n");
    });
    const rl = createInterface({ input: socket, crlfDelay: Infinity });
    rl.once("line", (line) => {
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(e);
      } finally {
        socket.destroy();
      }
    });
    socket.on("error", reject);
  });
}

// ── Tests ──

describe("ToolBridgeServer", () => {
  let server: ToolBridgeServer;

  afterEach(async () => {
    await server?.stop();
  });

  it("start → 소켓 파일 경로 반환", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    expect(path).toContain("bridge");
    expect(server.path).toBe(path);
  });

  it("tools/list → 전체 도구 목록 반환", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 1, method: "tools/list",
    });

    expect(res.error).toBeUndefined();
    const tools = (res.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(3);
  });

  it("tools/list + allowed_tools → 필터링된 목록", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    server = new ToolBridgeServer({
      mcp, logger: create_noop_logger(),
      allowed_tools: ["context7_resolve", "web_fetch"],
    });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 2, method: "tools/list",
    });

    const tools = (res.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(2);
  });

  it("tools/call → MCP call_tool 호출 + 결과 반환", async () => {
    const call_result: McpCallResult = {
      content: [{ type: "text", text: "React docs content..." }],
      is_error: false,
    };
    const mcp = create_mock_mcp(SAMPLE_TOOLS, call_result);
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "context7_resolve", arguments: { library: "react" } },
    });

    expect(res.error).toBeUndefined();
    const result = res.result as { content: unknown[]; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0]).toEqual({ type: "text", text: "React docs content..." });
    expect(mcp.call_tool).toHaveBeenCalledWith("context7_resolve", { library: "react" });
  });

  it("tools/call + allowed_tools → 비허용 도구 차단", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    server = new ToolBridgeServer({
      mcp, logger: create_noop_logger(),
      allowed_tools: ["web_fetch"],
    });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "context7_resolve", arguments: {} },
    });

    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("not allowed");
    expect(mcp.call_tool).not.toHaveBeenCalled();
  });

  it("tools/call — 도구 이름 누락 시 에러", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { arguments: {} },
    });

    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("missing tool name");
  });

  it("알 수 없는 method → 에러", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 6, method: "unknown/method" as any,
    });

    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("unknown method");
  });

  it("잘못된 JSON → parse_error", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await new Promise<BridgeResponse>((resolve, reject) => {
      const socket = createConnection(path, () => {
        socket.write("not-json\n");
      });
      const rl = createInterface({ input: socket, crlfDelay: Infinity });
      rl.once("line", (line) => {
        try { resolve(JSON.parse(line)); }
        catch (e) { reject(e); }
        finally { socket.destroy(); }
      });
      socket.on("error", reject);
    });

    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32700);
  });

  it("MCP call_tool 에러 시 에러 응답", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    (mcp.call_tool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network timeout"));
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    const res = await connect_and_request(path, {
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "web_fetch", arguments: { url: "https://example.com" } },
    });

    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain("network timeout");
  });

  it("다중 요청 순차 처리", async () => {
    const mcp = create_mock_mcp(SAMPLE_TOOLS);
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    const path = await server.start();

    // 동일 소켓에서 2개 요청 순차 전송
    const results = await new Promise<BridgeResponse[]>((resolve, reject) => {
      const responses: BridgeResponse[] = [];
      const socket = createConnection(path, () => {
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }) + "\n");
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "web_fetch", arguments: {} } }) + "\n");
      });
      const rl = createInterface({ input: socket, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          responses.push(JSON.parse(line));
          if (responses.length === 2) {
            socket.destroy();
            resolve(responses);
          }
        } catch (e) { reject(e); }
      });
      socket.on("error", reject);
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe(10);
    expect(results[1]!.id).toBe(11);
  });

  it("stop → 소켓 정리", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    await server.start();

    await server.stop();
    expect(server.path).toBeNull();
    expect(server.dir).toBeNull();
  });

  it("이중 start → 에러", async () => {
    const mcp = create_mock_mcp();
    server = new ToolBridgeServer({ mcp, logger: create_noop_logger() });
    await server.start();

    await expect(server.start()).rejects.toThrow("already started");
  });
});
