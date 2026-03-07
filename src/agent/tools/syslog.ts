/** Syslog 도구 — Syslog 메시지 전송 (UDP/TCP). */

import { createSocket } from "node:dgram";
import { createConnection, type Socket } from "node:net";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SyslogTool extends Tool {
  readonly name = "syslog";
  readonly category = "external" as const;
  readonly description = "Syslog message sender: send (UDP/TCP), format, parse.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["send", "format", "parse"], description: "Syslog operation" },
      host: { type: "string", description: "Syslog server host" },
      port: { type: "integer", description: "Syslog port (default: 514)" },
      protocol: { type: "string", enum: ["udp", "tcp"], description: "Transport (default: udp)" },
      facility: { type: "integer", description: "Syslog facility 0-23 (default: 1 = user)" },
      severity: { type: "integer", description: "Syslog severity 0-7 (default: 6 = info)" },
      message: { type: "string", description: "Log message" },
      hostname: { type: "string", description: "Hostname (default: localhost)" },
      app_name: { type: "string", description: "Application name" },
      input: { type: "string", description: "Syslog message to parse" },
      timeout_ms: { type: "integer", description: "Timeout in ms (default: 5000)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly FACILITY_NAMES = ["kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron", "authpriv", "ftp", "", "", "", "", "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7"];
  private readonly SEVERITY_NAMES = ["emerg", "alert", "crit", "error", "warning", "notice", "info", "debug"];

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "send");

    switch (action) {
      case "send": {
        const host = String(params.host || "");
        if (!host) return "Error: host is required";
        const port = Number(params.port) || 514;
        const protocol = String(params.protocol || "udp");
        const message = this.format_syslog(params);
        const timeout = Math.min(Number(params.timeout_ms) || 5000, 15000);

        if (protocol === "tcp") return this.send_tcp(host, port, message, timeout);
        return this.send_udp(host, port, message, timeout);
      }
      case "format": {
        const message = this.format_syslog(params);
        return JSON.stringify({ message });
      }
      case "parse": {
        const input = String(params.input || "");
        const match = input.match(/^<(\d+)>(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.*)$/);
        if (!match) return JSON.stringify({ error: "cannot parse syslog message" });
        const priority = Number(match[1]);
        const facility = Math.floor(priority / 8);
        const severity = priority % 8;
        return JSON.stringify({
          priority,
          facility,
          facility_name: this.FACILITY_NAMES[facility] || "unknown",
          severity,
          severity_name: this.SEVERITY_NAMES[severity] || "unknown",
          timestamp: match[2],
          hostname: match[3],
          app_name: match[4],
          pid: match[5] ? Number(match[5]) : null,
          message: match[6],
        });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private format_syslog(params: Record<string, unknown>): string {
    const facility = Math.max(0, Math.min(Number(params.facility) || 1, 23));
    const severity = Math.max(0, Math.min(Number(params.severity) || 6, 7));
    const priority = facility * 8 + severity;
    const hostname = String(params.hostname || "localhost");
    const app_name = String(params.app_name || "soulflow");
    const msg = String(params.message || "");
    const timestamp = new Date().toISOString();
    return `<${priority}>1 ${timestamp} ${hostname} ${app_name} - - - ${msg}`;
  }

  private send_udp(host: string, port: number, message: string, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.close(); resolve(JSON.stringify({ success: false, error: "timeout" })); }, timeout);
      const socket = createSocket("udp4");
      const buf = Buffer.from(message, "utf-8");
      socket.send(buf, 0, buf.length, port, host, (err) => {
        clearTimeout(timer);
        socket.close();
        if (err) resolve(JSON.stringify({ success: false, error: err.message }));
        else resolve(JSON.stringify({ success: true, protocol: "udp", bytes: buf.length }));
      });
    });
  }

  private send_tcp(host: string, port: number, message: string, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(JSON.stringify({ success: false, error: "timeout" })); }, timeout);
      const buf = Buffer.from(message + "\n", "utf-8");
      const socket: Socket = createConnection(port, host, () => {
        socket.write(buf, () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(JSON.stringify({ success: true, protocol: "tcp", bytes: buf.length }));
        });
      });
      socket.on("error", (err: Error) => { clearTimeout(timer); resolve(JSON.stringify({ success: false, error: err.message })); });
    });
  }
}
