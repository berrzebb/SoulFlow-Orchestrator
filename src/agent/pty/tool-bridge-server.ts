/**
 * ToolBridgeServer — Unix 소켓으로 컨테이너의 MCP 도구 요청을 수신하여 오케스트레이터 MCP로 중계.
 *
 * 컨테이너(network_mode=none)는 바인드 마운트된 소켓을 통해 도구를 호출.
 * 프로토콜: NDJSON over Unix socket (JSON-RPC 2.0 subset).
 */

import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type { Logger } from "../../logger.js";
import { error_message } from "../../utils/common.js";
import type { McpClientManager } from "../../mcp/client-manager.js";
import type { McpToolEntry } from "../../mcp/types.js";

const IS_WIN = process.platform === "win32";

// ── JSON-RPC 2.0 ──

export type BridgeRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: "tools/list" | "tools/call";
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

export type BridgeResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

// ── Options ──

export type ToolBridgeServerOptions = {
  mcp: McpClientManager;
  logger: Logger;
  /** 컨테이너가 호출 가능한 도구 화이트리스트. 비어있으면 전체 허용. */
  allowed_tools?: string[];
};

// ── Server ──

export class ToolBridgeServer {
  private server: Server | null = null;
  private socket_dir: string | null = null;
  private socket_path: string | null = null;
  private readonly mcp: McpClientManager;
  private readonly logger: Logger;
  private readonly allowed: Set<string> | null;

  constructor(options: ToolBridgeServerOptions) {
    this.mcp = options.mcp;
    this.logger = options.logger;
    this.allowed = options.allowed_tools?.length
      ? new Set(options.allowed_tools)
      : null;
  }

  /** 소켓 서버 시작. 반환값 = 소켓/파이프 경로 (바인드 마운트용). */
  async start(): Promise<string> {
    if (this.server) throw new Error("ToolBridgeServer already started");

    if (IS_WIN) {
      // Windows: named pipe
      const id = randomBytes(8).toString("hex");
      this.socket_path = `\\\\.\\pipe\\sf-bridge-${id}`;
    } else {
      // Linux/macOS: Unix domain socket
      this.socket_dir = await mkdtemp(join(tmpdir(), "sf-bridge-"));
      this.socket_path = join(this.socket_dir, "bridge.sock");
    }

    return new Promise<string>((resolve, reject) => {
      const srv = createServer((socket) => this.handle_connection(socket));
      srv.on("error", reject);
      srv.listen(this.socket_path!, () => {
        this.server = srv;
        this.logger.info("tool_bridge_started", { socket: this.socket_path });
        resolve(this.socket_path!);
      });
    });
  }

  /** 소켓 디렉토리 경로 (바인드 마운트 대상). */
  get dir(): string | null { return this.socket_dir; }

  /** 소켓 파일 경로. */
  get path(): string | null { return this.socket_path; }

  /** 허용된 도구 목록 반환. */
  list_tools(): McpToolEntry[] {
    const all = this.mcp.list_all_tools();
    if (!this.allowed) return all;
    return all.filter((t) => this.allowed!.has(t.name));
  }

  /** 종료 + 소켓 파일 정리. */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    if (this.socket_dir) {
      await rm(this.socket_dir, { recursive: true, force: true }).catch(() => {});
    }
    this.socket_dir = null;
    this.socket_path = null;
  }

  // ── 내부 ──

  private handle_connection(socket: Socket): void {
    const rl = createInterface({ input: socket, crlfDelay: Infinity });

    rl.on("line", (line) => {
      void this.process_line(line, socket).catch((err) => {
        this.logger.debug("process_line_error", { error: error_message(err) });
      });
    });

    socket.on("error", (err) => {
      this.logger.debug("bridge_socket_error", { error: err.message });
    });
  }

  private async process_line(line: string, socket: Socket): Promise<void> {
    let req: BridgeRequest;
    try {
      req = JSON.parse(line);
    } catch {
      this.send_response(socket, { jsonrpc: "2.0", id: 0, error: { code: -32700, message: "parse_error" } });
      return;
    }

    const response = await this.dispatch(req);
    this.send_response(socket, response);
  }

  private async dispatch(req: BridgeRequest): Promise<BridgeResponse> {
    const id = req.id;

    if (req.method === "tools/list") {
      const tools = this.list_tools().map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.input_schema,
      }));
      return { jsonrpc: "2.0", id, result: { tools } };
    }

    if (req.method === "tools/call") {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};

      if (!name) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "missing tool name" } };
      }

      // 화이트리스트 검사
      if (this.allowed && !this.allowed.has(name)) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `tool not allowed: ${name}` } };
      }

      try {
        const result = await this.mcp.call_tool(name, args);
        return { jsonrpc: "2.0", id, result: { content: result.content, isError: result.is_error } };
      } catch (err) {
        const msg = error_message(err);
        return { jsonrpc: "2.0", id, error: { code: -32000, message: msg } };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${req.method}` } };
  }

  private send_response(socket: Socket, response: BridgeResponse): void {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(response) + "\n");
    }
  }
}
