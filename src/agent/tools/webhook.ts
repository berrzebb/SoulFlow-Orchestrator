/** Webhook 도구 — 인바운드 HTTP 웹훅 리스너 관리. */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Tool } from "./base.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema } from "./types.js";

type WebhookEntry = {
  id: string;
  path: string;
  method: string;
  created_at: string;
  requests: Array<{ timestamp: string; method: string; headers: Record<string, string>; body: string }>;
};

const MAX_HOOKS = 20;
const MAX_REQUESTS_PER_HOOK = 50;

export class WebhookTool extends Tool {
  readonly name = "webhook";
  readonly category = "external" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Register inbound HTTP webhook listeners. Actions: register, list, remove, get_recent.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["register", "list", "remove", "get_recent"], description: "Operation" },
      path: { type: "string", description: "Webhook URL path (e.g. /hooks/my-event)" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "ANY"], description: "HTTP method filter (default: POST)" },
      webhook_id: { type: "string", description: "Webhook ID (for remove/get_recent)" },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Max recent requests to return" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly hooks = new Map<string, WebhookEntry>();
  private server: Server | null = null;
  private port = 0;

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "");

    switch (action) {
      case "register": return this.register(params);
      case "list": return this.list();
      case "remove": return this.remove(params);
      case "get_recent": return this.get_recent(params);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private async register(p: Record<string, unknown>): Promise<string> {
    const path = String(p.path || "").trim();
    if (!path || !path.startsWith("/")) return "Error: path must start with /";
    if (this.hooks.size >= MAX_HOOKS) return `Error: max ${MAX_HOOKS} webhooks`;

    const method = String(p.method || "POST").toUpperCase();
    const id = `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.hooks.set(id, { id, path, method, created_at: new Date().toISOString(), requests: [] });

    if (!this.server) {
      try { await this.start_server(); } catch (err) { return `Error: ${error_message(err)}`; }
    }

    return JSON.stringify({ id, path, method, port: this.port, url: `http://localhost:${this.port}${path}` });
  }

  private list(): string {
    const entries = [...this.hooks.values()].map(({ id, path, method, created_at, requests }) => ({
      id, path, method, created_at, request_count: requests.length,
    }));
    return JSON.stringify({ webhooks: entries, port: this.port || null });
  }

  private remove(p: Record<string, unknown>): string {
    const id = String(p.webhook_id || "").trim();
    if (!id) return "Error: webhook_id is required";
    if (!this.hooks.delete(id)) return `Error: webhook "${id}" not found`;
    if (this.hooks.size === 0 && this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
    return `Removed webhook "${id}"`;
  }

  private get_recent(p: Record<string, unknown>): string {
    const id = String(p.webhook_id || "").trim();
    if (!id) return "Error: webhook_id is required";
    const hook = this.hooks.get(id);
    if (!hook) return `Error: webhook "${id}" not found`;
    const limit = Math.min(50, Math.max(1, Number(p.limit || 10)));
    return JSON.stringify({ id: hook.id, path: hook.path, requests: hook.requests.slice(-limit) });
  }

  private start_server(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handle_request(req, res);
      });
      server.listen(0, () => {
        const addr = server.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        this.server = server;
        resolve();
      });
      server.on("error", reject);
    });
  }

  private handle_request(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url || "/";
      const method = (req.method || "GET").toUpperCase();

      let matched = false;
      for (const hook of this.hooks.values()) {
        if (url.startsWith(hook.path) && (hook.method === "ANY" || hook.method === method)) {
          hook.requests.push({
            timestamp: new Date().toISOString(),
            method,
            headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
            body: body.slice(0, 10_000),
          });
          if (hook.requests.length > MAX_REQUESTS_PER_HOOK) hook.requests.shift();
          matched = true;
        }
      }

      res.writeHead(matched ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: matched }));
    });
  }
}
