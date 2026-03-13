/** SSH 도구 — 원격 서버 명령 실행. Node.js child_process + ssh CLI 래퍼. */

import { execFile } from "node:child_process";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SshTool extends Tool {
  readonly name = "ssh";
  readonly category = "external" as const;
  readonly description = "SSH remote execution: exec, scp_upload, scp_download, info.";
  readonly policy_flags = { network: true, write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["exec", "scp_upload", "scp_download", "info"], description: "SSH operation" },
      host: { type: "string", description: "Remote host (user@host or host)" },
      port: { type: "integer", description: "SSH port (default: 22)" },
      command: { type: "string", description: "Remote command to execute (exec)" },
      local_path: { type: "string", description: "Local file path (scp)" },
      remote_path: { type: "string", description: "Remote file path (scp)" },
      identity_file: { type: "string", description: "Path to SSH private key" },
      timeout_ms: { type: "integer", description: "Timeout in ms (default: 30000)" },
    },
    required: ["action", "host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "exec");
    const host = String(params.host || "");
    if (!host) return "Error: host is required";
    const port = Number(params.port) || 22;
    const identity = params.identity_file ? String(params.identity_file) : null;
    const timeout = Math.min(Number(params.timeout_ms) || 30000, 120000);

    const base_args = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-p", String(port)];
    if (identity) base_args.push("-i", identity);

    switch (action) {
      case "exec": {
        const cmd = String(params.command || "");
        if (!cmd) return "Error: command is required";
        return this.run_ssh(["ssh", ...base_args, host, cmd], timeout);
      }
      case "scp_upload": {
        const local = String(params.local_path || "");
        const remote = String(params.remote_path || "");
        if (!local || !remote) return "Error: local_path and remote_path required";
        const scp_args = ["scp", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-P", String(port)];
        if (identity) scp_args.push("-i", identity);
        scp_args.push(local, `${host}:${remote}`);
        return this.run_ssh(scp_args, timeout);
      }
      case "scp_download": {
        const local = String(params.local_path || "");
        const remote = String(params.remote_path || "");
        if (!local || !remote) return "Error: local_path and remote_path required";
        const scp_args = ["scp", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-P", String(port)];
        if (identity) scp_args.push("-i", identity);
        scp_args.push(`${host}:${remote}`, local);
        return this.run_ssh(scp_args, timeout);
      }
      case "info":
        return this.run_ssh(["ssh", ...base_args, host, "uname -a && whoami && pwd"], timeout);
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private run_ssh(args: string[], timeout: number): Promise<string> {
    const [cmd, ...rest] = args;
    return new Promise((resolve) => {
      execFile(cmd!, rest, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve(JSON.stringify({ success: false, error: err.message, stderr: stderr?.slice(0, 500) }));
        } else {
          resolve(JSON.stringify({ success: true, stdout: stdout.slice(0, 10000), stderr: stderr?.slice(0, 1000) || "" }));
        }
      });
    });
  }
}
