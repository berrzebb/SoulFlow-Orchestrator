/** LDAP 도구 — LDAP 검색/바인드 (raw TCP 프로토콜, BER 인코딩). */

import { createConnection, type Socket } from "node:net";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class LdapTool extends Tool {
  readonly name = "ldap";
  readonly category = "external" as const;
  readonly description = "LDAP client: bind, search, info.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["bind", "search", "info"], description: "LDAP operation" },
      host: { type: "string", description: "LDAP server host" },
      port: { type: "integer", description: "LDAP port (default: 389)" },
      bind_dn: { type: "string", description: "Bind DN (e.g. cn=admin,dc=example,dc=com)" },
      password: { type: "string", description: "Bind password" },
      base_dn: { type: "string", description: "Search base DN" },
      filter: { type: "string", description: "Search filter (e.g. (objectClass=person))" },
      scope: { type: "string", enum: ["base", "one", "sub"], description: "Search scope (default: sub)" },
      attributes: { type: "string", description: "Comma-separated attribute names" },
      timeout_ms: { type: "integer", description: "Timeout in ms (default: 10000)" },
    },
    required: ["action", "host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "search");
    const host = String(params.host || "");
    if (!host) return "Error: host is required";
    const port = Number(params.port) || 389;
    const timeout = Math.min(Number(params.timeout_ms) || 10000, 30000);

    switch (action) {
      case "bind": {
        const bind_dn = String(params.bind_dn || "");
        const password = String(params.password || "");
        return this.ldap_bind(host, port, bind_dn, password, timeout);
      }
      case "search": {
        const bind_dn = String(params.bind_dn || "");
        const password = String(params.password || "");
        const base_dn = String(params.base_dn || "");
        const filter = String(params.filter || "(objectClass=*)");
        const scope = String(params.scope || "sub");
        const attrs = params.attributes ? String(params.attributes).split(",").map((a) => a.trim()) : [];
        return this.ldap_search(host, port, bind_dn, password, base_dn, filter, scope, attrs, timeout);
      }
      case "info":
        return JSON.stringify({ host, port, note: "Use bind to test connection, search to query entries" });
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private ber_length(len: number): Buffer {
    if (len < 0x80) return Buffer.from([len]);
    if (len < 0x100) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xFF, len & 0xFF]);
  }

  private ber_string(tag: number, value: string): Buffer {
    const val_buf = Buffer.from(value, "utf-8");
    const len_buf = this.ber_length(val_buf.length);
    return Buffer.concat([Buffer.from([tag]), len_buf, val_buf]);
  }

  private ber_int(value: number): Buffer {
    const bytes: number[] = [];
    let v = value;
    do { bytes.unshift(v & 0xFF); v >>= 8; } while (v > 0);
    if (bytes[0]! > 0x7F) bytes.unshift(0);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), Buffer.from(bytes)]);
  }

  private ber_sequence(tag: number, ...parts: Buffer[]): Buffer {
    const content = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([tag]), this.ber_length(content.length), content]);
  }

  private build_bind_request(msg_id: number, dn: string, password: string): Buffer {
    const bind_request = this.ber_sequence(0x60,
      this.ber_int(3),
      this.ber_string(0x04, dn),
      this.ber_string(0x80, password),
    );
    return this.ber_sequence(0x30, this.ber_int(msg_id), bind_request);
  }

  private build_search_request(msg_id: number, base_dn: string, scope: string, filter: string, attrs: string[]): Buffer {
    const scope_val = scope === "base" ? 0 : scope === "one" ? 1 : 2;
    const filter_attr = filter.replace(/^\(|\)$/g, "").split("=")[0] || "objectClass";
    const eq_filter = this.ber_sequence(0xA3, this.ber_string(0x04, filter_attr), this.ber_string(0x04, filter.replace(/^\(|\)$/g, "").split("=")[1] || "*"));
    const attr_bufs = attrs.map((a) => this.ber_string(0x04, a));
    const attr_seq = this.ber_sequence(0x30, ...attr_bufs);

    const search_request = this.ber_sequence(0x63,
      this.ber_string(0x04, base_dn),
      Buffer.from([0x0A, 0x01, scope_val]),
      Buffer.from([0x0A, 0x01, 0x00]),
      this.ber_int(0),
      this.ber_int(0),
      Buffer.from([0x01, 0x01, 0x00]),
      eq_filter,
      attr_seq,
    );
    return this.ber_sequence(0x30, this.ber_int(msg_id), search_request);
  }

  private ldap_bind(host: string, port: number, dn: string, password: string, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(JSON.stringify({ success: false, error: "timeout" })); }, timeout);
      const socket: Socket = createConnection(port, host, () => {
        socket.write(this.build_bind_request(1, dn, password));
      });
      socket.once("data", (data: Buffer) => {
        clearTimeout(timer);
        socket.destroy();
        const success = data.length > 10 && data[data.length - 3] === 0x0A && data[data.length - 1] === 0x00;
        resolve(JSON.stringify({ success, message: success ? "bind successful" : "bind failed" }));
      });
      socket.on("error", (err: Error) => { clearTimeout(timer); resolve(JSON.stringify({ success: false, error: err.message })); });
    });
  }

  private ldap_search(host: string, port: number, bind_dn: string, password: string, base_dn: string, filter: string, scope: string, attrs: string[], timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(JSON.stringify({ success: false, error: "timeout" })); }, timeout);
      let phase: "bind" | "search" = "bind";
      const chunks: Buffer[] = [];

      const socket: Socket = createConnection(port, host, () => {
        socket.write(this.build_bind_request(1, bind_dn, password));
      });

      socket.on("data", (data: Buffer) => {
        if (phase === "bind") {
          phase = "search";
          socket.write(this.build_search_request(2, base_dn, scope, filter, attrs));
          return;
        }
        chunks.push(data);
        const combined = Buffer.concat(chunks);
        if (combined.includes(Buffer.from([0x65]))) {
          clearTimeout(timer);
          socket.destroy();
          resolve(JSON.stringify({
            success: true,
            note: "Raw LDAP response received. Full LDAP BER decoding requires a dedicated library.",
            response_size: combined.length,
            base_dn,
            filter,
          }));
        }
      });

      socket.on("error", (err: Error) => { clearTimeout(timer); resolve(JSON.stringify({ success: false, error: err.message })); });
    });
  }
}
