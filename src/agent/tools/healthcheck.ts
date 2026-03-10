/** Healthcheck 도구 — HTTP/TCP/DNS 헬스체크 + 다중 엔드포인트 체크. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class HealthcheckTool extends Tool {
  readonly name = "healthcheck";
  readonly category = "external" as const;
  readonly description = "Health check utilities: http, tcp, dns, multi, ping.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["http", "tcp", "dns", "multi", "ping"], description: "Check type" },
      url: { type: "string", description: "URL for HTTP check" },
      host: { type: "string", description: "Host for TCP/DNS check" },
      port: { type: "number", description: "Port for TCP check" },
      timeout_ms: { type: "number", description: "Timeout in ms (default: 5000)" },
      expected_status: { type: "number", description: "Expected HTTP status (default: 200)" },
      endpoints: { type: "string", description: "JSON array of endpoints for multi check" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "http");
    const timeout = Number(params.timeout_ms) || 5000;

    switch (action) {
      case "http": {
        const url = String(params.url || "");
        const expected = Number(params.expected_status) || 200;
        return JSON.stringify(await this.check_http(url, timeout, expected));
      }
      case "tcp": {
        const host = String(params.host || "");
        const port = Number(params.port) || 80;
        return JSON.stringify(await this.check_tcp(host, port, timeout));
      }
      case "dns": {
        const host = String(params.host || "");
        return JSON.stringify(await this.check_dns(host));
      }
      case "multi": {
        let endpoints: { type: string; url?: string; host?: string; port?: number }[];
        try { endpoints = JSON.parse(String(params.endpoints || "[]")); } catch { return JSON.stringify({ error: "invalid endpoints JSON" }); }
        const results = await Promise.all(endpoints.map(async (ep): Promise<Record<string, unknown>> => {
          if (ep.type === "http" && ep.url) return { ...ep, ...(await this.check_http(ep.url, timeout, 200)) };
          if (ep.type === "tcp" && ep.host) return { ...ep, ...(await this.check_tcp(ep.host, ep.port || 80, timeout)) };
          if (ep.type === "dns" && ep.host) return { ...ep, ...(await this.check_dns(ep.host)) };
          return { ...ep, healthy: false, error: "invalid endpoint config" };
        }));
        const all_healthy = results.every((r) => r.healthy);
        return JSON.stringify({ all_healthy, total: results.length, healthy_count: results.filter((r) => r.healthy).length, results });
      }
      case "ping": {
        const host = String(params.host || "");
        return JSON.stringify(await this.check_dns(host));
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private async check_http(url: string, timeout: number, expected: number): Promise<Record<string, unknown>> {
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout), method: "GET", redirect: "follow" });
      const latency = Date.now() - start;
      return { healthy: res.status === expected, status: res.status, latency_ms: latency, url };
    } catch (e) {
      return { healthy: false, error: String(e instanceof Error ? e.message : e), latency_ms: Date.now() - start, url };
    }
  }

  private async check_tcp(host: string, port: number, timeout: number): Promise<Record<string, unknown>> {
    const { createConnection } = await import("node:net");
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = createConnection({ host, port, timeout }, () => {
        socket.destroy();
        resolve({ healthy: true, host, port, latency_ms: Date.now() - start });
      });
      socket.on("error", (err) => {
        socket.destroy();
        resolve({ healthy: false, host, port, error: err.message, latency_ms: Date.now() - start });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ healthy: false, host, port, error: "timeout", latency_ms: Date.now() - start });
      });
    });
  }

  private async check_dns(host: string): Promise<Record<string, unknown>> {
    const { promises: dns } = await import("node:dns");
    const start = Date.now();
    try {
      const addresses = await dns.resolve4(host);
      return { healthy: true, host, addresses, latency_ms: Date.now() - start };
    } catch (e) {
      return { healthy: false, host, error: String(e instanceof Error ? e.message : e), latency_ms: Date.now() - start };
    }
  }
}
