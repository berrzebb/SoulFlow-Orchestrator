/**
 * MCP 클라이언트 매니저 — MCP 서버 프로세스 생성, 도구 발견, 도구 호출, 라이프사이클 관리.
 * @modelcontextprotocol/sdk의 Client + StdioClientTransport를 사용한다.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type {
  McpServerConfig,
  McpToolEntry,
  McpCallResult,
  McpServerStatus,
} from "./types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const CLIENT_NAME = "soulflow-orchestrator";
const CLIENT_VERSION = "0.1.0";

type ActiveServer = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolEntry[];
  config: McpServerConfig;
};

export type McpClientManagerDeps = {
  logger: Logger;
};

export class McpClientManager implements ServiceLike {
  readonly name = "mcp-client";

  private readonly logger: Logger;
  private readonly servers = new Map<string, ActiveServer>();
  private readonly tool_index = new Map<string, string>();
  private readonly configs = new Map<string, McpServerConfig>();
  private running = false;

  constructor(deps: McpClientManagerDeps) {
    this.logger = deps.logger;
  }

  /** 시작 전에 서버 설정을 등록한다. start() 호출 시 일괄 연결. */
  register_server(name: string, config: McpServerConfig): void {
    this.configs.set(name, config);
  }

  /** 등록된 서버 설정을 제거한다. 이미 연결된 경우 중지도 수행. */
  async unregister_server(name: string): Promise<void> {
    this.configs.delete(name);
    await this.stop_server(name);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const entries = [...this.configs.entries()];
    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.connect_server(name, config)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        this.logger.warn("mcp server start failed", {
          server: entries[i][0],
          error: String(result.reason),
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    const names = [...this.servers.keys()];
    await Promise.allSettled(names.map((n) => this.stop_server(n)));
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return {
      ok: this.running,
      details: {
        server_count: this.servers.size,
        tool_count: this.tool_index.size,
        servers: [...this.servers.keys()],
      },
    };
  }

  /** 단일 MCP 서버에 연결하고 도구를 발견한다. */
  async connect_server(name: string, config: McpServerConfig): Promise<McpToolEntry[]> {
    if (this.servers.has(name)) {
      await this.stop_server(name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });

    const client = new Client(
      { name: CLIENT_NAME, version: CLIENT_VERSION },
      { capabilities: {} },
    );

    const timeout_ms = config.startup_timeout_ms ?? DEFAULT_STARTUP_TIMEOUT_MS;
    await with_timeout(client.connect(transport), timeout_ms, `mcp_connect_timeout:${name}`);

    const response = await client.listTools();
    const tools: McpToolEntry[] = (response.tools || []).map((t) => ({
      server_name: name,
      name: t.name,
      description: t.description,
      input_schema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));

    for (const tool of tools) {
      const prev_server = this.tool_index.get(tool.name);
      if (prev_server && prev_server !== name) {
        this.logger.warn("mcp tool name collision", { tool: tool.name, prev_server, new_server: name });
      }
      this.tool_index.set(tool.name, name);
    }

    this.servers.set(name, { name, client, transport, tools, config });
    this.logger.info("mcp server connected", { server: name, tools: tools.length });
    return tools;
  }

  /** 단일 MCP 서버를 중지한다. */
  async stop_server(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    for (const tool of server.tools) {
      if (this.tool_index.get(tool.name) === name) {
        this.tool_index.delete(tool.name);
      }
    }
    this.servers.delete(name);

    try {
      await server.client.close();
    } catch (error) {
      this.logger.debug("mcp server close error", { server: name, error: String(error) });
    }
  }

  /** MCP 서버의 도구를 호출한다. signal이 전달되면 abort 시 즉시 에러 반환. */
  async call_tool(tool_name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Error: aborted" }], is_error: true };
    }

    const server_name = this.tool_index.get(tool_name);
    if (!server_name) {
      return { content: [{ type: "text", text: `Error: unknown_mcp_tool:${tool_name}` }], is_error: true };
    }

    const server = this.servers.get(server_name);
    if (!server) {
      return { content: [{ type: "text", text: `Error: mcp_server_not_running:${server_name}` }], is_error: true };
    }

    try {
      const call_promise = server.client.callTool({ name: tool_name, arguments: args });

      if (signal) {
        const abort_promise = new Promise<never>((_, reject) => {
          const on_abort = () => reject(new Error("aborted"));
          if (signal.aborted) { on_abort(); return; }
          signal.addEventListener("abort", on_abort, { once: true });
          call_promise.finally(() => signal.removeEventListener("abort", on_abort));
        });
        const result = await Promise.race([call_promise, abort_promise]);
        const content = (result.content as McpCallResult["content"]) || [];
        return { content, is_error: result.isError === true };
      }

      const result = await call_promise;
      const content = (result.content as McpCallResult["content"]) || [];
      return { content, is_error: result.isError === true };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error calling MCP tool ${tool_name}: ${String(error)}` }],
        is_error: true,
      };
    }
  }

  /** 모든 연결된 서버의 도구 목록. */
  list_all_tools(): McpToolEntry[] {
    const out: McpToolEntry[] = [];
    for (const server of this.servers.values()) {
      out.push(...server.tools);
    }
    return out;
  }

  /** 서버 상태 목록. */
  list_servers(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];
    for (const [name, config] of this.configs.entries()) {
      const server = this.servers.get(name);
      statuses.push({
        name,
        connected: !!server,
        tools: server?.tools ?? [],
        error: server ? undefined : `not_connected (command: ${config.command})`,
      });
    }
    return statuses;
  }

  /** 도구 이름으로 서버를 찾는다. */
  get_server_for_tool(tool_name: string): string | null {
    return this.tool_index.get(tool_name) ?? null;
  }

  /** 연결된 서버 수. */
  get connected_count(): number {
    return this.servers.size;
  }

  /** 발견된 총 도구 수. */
  get tool_count(): number {
    return this.tool_index.size;
  }
}

function with_timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
