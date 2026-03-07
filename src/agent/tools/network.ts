/** Network 도구 — 네트워크 진단 (ping, dns, port check, curl head). */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class NetworkTool extends Tool {
  readonly name = "network";
  readonly category = "shell" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Network diagnostics: ping, dns lookup, port check, HTTP head, netstat.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["ping", "dns", "port_check", "http_head", "netstat"],
        description: "Network operation",
      },
      host: { type: "string", description: "Target hostname or IP" },
      port: { type: "integer", minimum: 1, maximum: 65535, description: "Port number (for port_check)" },
      count: { type: "integer", minimum: 1, maximum: 10, description: "Ping count (default 3)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options: { workspace: string }) {
    super();
    this.workspace = options.workspace;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "ping");
    const host = String(params.host || "").trim();
    const port = Number(params.port || 0);
    const count = Math.max(1, Math.min(10, Number(params.count || 3)));

    if (context?.signal?.aborted) return "Error: cancelled";

    try {
      switch (op) {
        case "ping": {
          if (!host) return "Error: host is required";
          return await this.exec(`ping -c ${count} -W 3 ${this.safe_host(host)}`, context);
        }
        case "dns": {
          if (!host) return "Error: host is required";
          const cmds = [
            `dig +short ${this.safe_host(host)} A 2>/dev/null || nslookup ${this.safe_host(host)} 2>/dev/null`,
          ];
          return await this.exec(cmds[0], context);
        }
        case "port_check": {
          if (!host || !port) return "Error: host and port are required";
          return await this.exec(
            `timeout 5 bash -c 'echo > /dev/tcp/${this.safe_host(host)}/${port}' 2>&1 && echo "OPEN" || echo "CLOSED/FILTERED"`,
            context,
          );
        }
        case "http_head": {
          if (!host) return "Error: host is required";
          const url = host.startsWith("http") ? host : `https://${host}`;
          return await this.exec(`curl -sI -m 10 --max-redirs 3 ${this.safe_url(url)}`, context);
        }
        case "netstat": {
          return await this.exec("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null", context);
        }
        default:
          return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private async exec(cmd: string, context?: ToolExecutionContext): Promise<string> {
    const { stdout, stderr } = await run_shell_command(cmd, {
      cwd: this.workspace,
      timeout_ms: 15_000,
      max_buffer_bytes: 1024 * 256,
      signal: context?.signal,
    });
    const output = [stdout || "", stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
    return output || "(no output)";
  }

  private safe_host(host: string): string {
    return host.replace(/[;&|`$(){}]/g, "");
  }

  private safe_url(url: string): string {
    return `"${url.replace(/"/g, "")}"`;
  }
}
