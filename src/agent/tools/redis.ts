/** Redis 도구 — Redis RESP 프로토콜 직접 구현 (외부 의존성 없음). */

import { createConnection, type Socket } from "node:net";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class RedisTool extends Tool {
  readonly name = "redis";
  readonly category = "external" as const;
  readonly description = "Redis client: get, set, del, keys, info, hget, hset, lpush, lrange, expire, ttl, incr, ping.";
  readonly policy_flags = { network: true, write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["get", "set", "del", "keys", "info", "hget", "hset", "lpush", "lrange", "expire", "ttl", "incr", "ping"], description: "Redis operation" },
      host: { type: "string", description: "Redis host (default: localhost)" },
      port: { type: "integer", description: "Redis port (default: 6379)" },
      password: { type: "string", description: "Redis password" },
      key: { type: "string", description: "Redis key" },
      value: { type: "string", description: "Value (set/hset/lpush)" },
      field: { type: "string", description: "Hash field (hget/hset)" },
      pattern: { type: "string", description: "Key pattern for keys (default: *)" },
      ttl: { type: "integer", description: "TTL in seconds (set/expire)" },
      start: { type: "integer", description: "Start index (lrange, default: 0)" },
      stop: { type: "integer", description: "Stop index (lrange, default: -1)" },
      timeout_ms: { type: "integer", description: "Timeout in ms (default: 5000)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "ping");
    const host = String(params.host || "localhost");
    const port = Number(params.port) || 6379;
    const password = params.password ? String(params.password) : null;
    const timeout = Math.min(Number(params.timeout_ms) || 5000, 30000);

    try {
      const cmds: string[][] = [];
      if (password) cmds.push(["AUTH", password]);

      switch (action) {
        case "ping": cmds.push(["PING"]); break;
        case "get": cmds.push(["GET", String(params.key || "")]); break;
        case "set": {
          const args = ["SET", String(params.key || ""), String(params.value || "")];
          if (params.ttl) args.push("EX", String(params.ttl));
          cmds.push(args);
          break;
        }
        case "del": cmds.push(["DEL", String(params.key || "")]); break;
        case "keys": cmds.push(["KEYS", String(params.pattern || "*")]); break;
        case "info": cmds.push(["INFO", "server"]); break;
        case "hget": cmds.push(["HGET", String(params.key || ""), String(params.field || "")]); break;
        case "hset": cmds.push(["HSET", String(params.key || ""), String(params.field || ""), String(params.value || "")]); break;
        case "lpush": cmds.push(["LPUSH", String(params.key || ""), String(params.value || "")]); break;
        case "lrange": cmds.push(["LRANGE", String(params.key || ""), String(params.start ?? 0), String(params.stop ?? -1)]); break;
        case "expire": cmds.push(["EXPIRE", String(params.key || ""), String(params.ttl || 60)]); break;
        case "ttl": cmds.push(["TTL", String(params.key || "")]); break;
        case "incr": cmds.push(["INCR", String(params.key || "")]); break;
        default: return `Error: unsupported action "${action}"`;
      }

      const results = await this.execute_commands(host, port, cmds, timeout);
      const result = password ? results.slice(1) : results;
      return JSON.stringify({ success: true, action, result: result.length === 1 ? result[0] : result });
    } catch (err) {
      return JSON.stringify({ success: false, error: (err as Error).message });
    }
  }

  private encode_command(args: string[]): string {
    let cmd = `*${args.length}\r\n`;
    for (const arg of args) cmd += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
    return cmd;
  }

  private execute_commands(host: string, port: number, cmds: string[][], timeout: number): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("timeout")); }, timeout);
      let buffer = "";
      const results: unknown[] = [];
      const expected = cmds.length;

      const socket: Socket = createConnection(port, host, () => {
        for (const cmd of cmds) socket.write(this.encode_command(cmd));
      });

      socket.on("data", (data: Buffer) => {
        buffer += data.toString("utf-8");
        while (buffer.length > 0) {
          const parsed = this.parse_resp(buffer);
          if (!parsed) break;
          results.push(parsed.value);
          buffer = parsed.rest;
          if (results.length >= expected) {
            clearTimeout(timer);
            socket.destroy();
            resolve(results);
            return;
          }
        }
      });

      socket.on("error", (err: Error) => { clearTimeout(timer); reject(err); });
    });
  }

  private parse_resp(data: string): { value: unknown; rest: string } | null {
    if (data.length === 0) return null;
    const nl = data.indexOf("\r\n");
    if (nl === -1) return null;

    const type = data[0];
    const line = data.slice(1, nl);
    const rest = data.slice(nl + 2);

    switch (type) {
      case "+": return { value: line, rest };
      case "-": return { value: `ERROR: ${line}`, rest };
      case ":": return { value: Number(line), rest };
      case "$": {
        const len = Number(line);
        if (len === -1) return { value: null, rest };
        if (rest.length < len + 2) return null;
        return { value: rest.slice(0, len), rest: rest.slice(len + 2) };
      }
      case "*": {
        const count = Number(line);
        if (count === -1) return { value: null, rest };
        let remaining = rest;
        const arr: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const parsed = this.parse_resp(remaining);
          if (!parsed) return null;
          arr.push(parsed.value);
          remaining = parsed.rest;
        }
        return { value: arr, rest: remaining };
      }
      default:
        return { value: line, rest };
    }
  }
}
