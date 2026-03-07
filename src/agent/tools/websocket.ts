/** WebSocket 도구 — WebSocket 클라이언트 (connect/send/listen/close). */

// @ts-expect-error ws has no type declarations in this project
import { WebSocket } from "ws";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const connections = new Map<string, { ws: WebSocket; messages: string[]; created: number }>();
const MAX_CONNECTIONS = 10;
const MAX_MESSAGES = 100;

export class WebSocketTool extends Tool {
  readonly name = "websocket";
  readonly category = "external" as const;
  readonly description = "WebSocket client: connect, send, receive, close, list.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["connect", "send", "receive", "close", "list"], description: "WebSocket operation" },
      url: { type: "string", description: "WebSocket URL (ws:// or wss://)" },
      id: { type: "string", description: "Connection ID (auto-generated on connect)" },
      message: { type: "string", description: "Message to send (for send action)" },
      count: { type: "integer", description: "Max messages to receive (default: 10)" },
      timeout_ms: { type: "integer", description: "Connect/receive timeout (default: 5000)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "list");

    switch (action) {
      case "connect": return this.connect(params);
      case "send": return this.send(params);
      case "receive": return this.receive(params);
      case "close": return this.close_conn(params);
      case "list": return this.list();
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private connect(params: Record<string, unknown>): Promise<string> {
    const url = String(params.url || "");
    if (!url) return Promise.resolve("Error: url is required");
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      return Promise.resolve("Error: url must start with ws:// or wss://");
    }
    if (connections.size >= MAX_CONNECTIONS) {
      return Promise.resolve(`Error: max ${MAX_CONNECTIONS} connections reached`);
    }

    const timeout = Math.min(Number(params.timeout_ms) || 5000, 30000);
    const id = String(params.id || `ws_${Date.now()}`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.close();
        resolve("Error: connection timeout");
      }, timeout);

      const ws = new WebSocket(url);

      ws.on("open", () => {
        clearTimeout(timer);
        const entry = { ws, messages: [] as string[], created: Date.now() };
        connections.set(id, entry);

        ws.on("message", (data: Buffer | string) => {
          if (entry.messages.length < MAX_MESSAGES) {
            entry.messages.push(String(data));
          }
        });

        ws.on("close", () => { connections.delete(id); });
        ws.on("error", () => { connections.delete(id); });

        resolve(JSON.stringify({ id, url, status: "connected" }));
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve(`Error: ${err.message}`);
      });
    });
  }

  private send(params: Record<string, unknown>): Promise<string> {
    const id = String(params.id || "");
    const message = String(params.message || "");
    const entry = connections.get(id);
    if (!entry) return Promise.resolve(`Error: connection "${id}" not found`);
    if (entry.ws.readyState !== WebSocket.OPEN) return Promise.resolve("Error: connection not open");

    return new Promise((resolve) => {
      entry.ws.send(message, (err: Error | undefined) => {
        if (err) resolve(`Error: ${err.message}`);
        else resolve(JSON.stringify({ id, sent: true, length: message.length }));
      });
    });
  }

  private receive(params: Record<string, unknown>): Promise<string> {
    const id = String(params.id || "");
    const count = Math.max(1, Math.min(100, Number(params.count) || 10));
    const timeout = Math.min(Number(params.timeout_ms) || 5000, 30000);
    const entry = connections.get(id);
    if (!entry) return Promise.resolve(`Error: connection "${id}" not found`);

    if (entry.messages.length > 0) {
      const msgs = entry.messages.splice(0, count);
      return Promise.resolve(JSON.stringify({ id, messages: msgs, count: msgs.length }));
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const msgs = entry.messages.splice(0, count);
        resolve(JSON.stringify({ id, messages: msgs, count: msgs.length, timeout: true }));
      }, timeout);

      const check = (): void => {
        if (entry.messages.length > 0) {
          clearTimeout(timer);
          const msgs = entry.messages.splice(0, count);
          resolve(JSON.stringify({ id, messages: msgs, count: msgs.length }));
        } else if (entry.ws.readyState !== WebSocket.OPEN) {
          clearTimeout(timer);
          resolve(JSON.stringify({ id, messages: [], count: 0, closed: true }));
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });
  }

  private close_conn(params: Record<string, unknown>): Promise<string> {
    const id = String(params.id || "");
    const entry = connections.get(id);
    if (!entry) return Promise.resolve(`Error: connection "${id}" not found`);
    entry.ws.close();
    connections.delete(id);
    return Promise.resolve(JSON.stringify({ id, status: "closed" }));
  }

  private list(): string {
    const list = [...connections.entries()].map(([id, e]) => ({
      id,
      state: e.ws.readyState === WebSocket.OPEN ? "open" : "closed",
      buffered_messages: e.messages.length,
      age_ms: Date.now() - e.created,
    }));
    return JSON.stringify({ connections: list, count: list.length });
  }
}
