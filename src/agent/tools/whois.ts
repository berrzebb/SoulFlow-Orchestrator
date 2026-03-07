/** WHOIS 도구 — 도메인/IP WHOIS 조회 (raw TCP port 43). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const WHOIS_SERVERS: Record<string, string> = {
  com: "whois.verisign-grs.com", net: "whois.verisign-grs.com", org: "whois.pir.org",
  io: "whois.nic.io", dev: "whois.nic.google", app: "whois.nic.google",
  co: "whois.nic.co", me: "whois.nic.me", info: "whois.afilias.net",
  biz: "whois.biz", xyz: "whois.nic.xyz", kr: "whois.kr",
  jp: "whois.jprs.jp", uk: "whois.nic.uk", de: "whois.denic.de",
  fr: "whois.nic.fr", eu: "whois.eu",
};

export class WhoisTool extends Tool {
  readonly name = "whois";
  readonly category = "external" as const;
  readonly description = "WHOIS lookup: query domain/IP registration info via raw TCP.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["query", "parse", "server"], description: "Operation" },
      domain: { type: "string", description: "Domain name or IP" },
      server: { type: "string", description: "WHOIS server override" },
      timeout_ms: { type: "number", description: "Timeout (default: 10000)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "query");

    switch (action) {
      case "query": {
        const domain = String(params.domain || "");
        const server = params.server ? String(params.server) : this.find_server(domain);
        const timeout = Number(params.timeout_ms) || 10000;
        const raw = await this.whois_query(domain, server, timeout);
        const parsed = this.parse_whois(raw);
        return JSON.stringify({ domain, server, ...parsed, raw: raw.slice(0, 2000) });
      }
      case "parse": {
        const domain = String(params.domain || "");
        const server = params.server ? String(params.server) : this.find_server(domain);
        const timeout = Number(params.timeout_ms) || 10000;
        const raw = await this.whois_query(domain, server, timeout);
        return JSON.stringify(this.parse_whois(raw));
      }
      case "server": {
        const domain = String(params.domain || "");
        const server = this.find_server(domain);
        return JSON.stringify({ domain, server, known_servers: WHOIS_SERVERS });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private find_server(domain: string): string {
    const parts = domain.split(".");
    const tld = parts[parts.length - 1]?.toLowerCase() || "";
    return WHOIS_SERVERS[tld] || "whois.iana.org";
  }

  private async whois_query(domain: string, server: string, timeout: number): Promise<string> {
    const { createConnection } = await import("node:net");
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const socket = createConnection({ host: server, port: 43, timeout }, () => {
        socket.write(`${domain}\r\n`);
      });
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      socket.on("error", (err) => resolve(`Error: ${err.message}`));
      socket.on("timeout", () => { socket.destroy(); resolve("Error: timeout"); });
    });
  }

  private parse_whois(raw: string): Record<string, unknown> {
    const result: Record<string, string> = {};
    const key_map: Record<string, string> = {
      "domain name": "domain_name",
      "registrar": "registrar",
      "creation date": "created",
      "updated date": "updated",
      "registry expiry date": "expires",
      "expiration date": "expires",
      "registrant organization": "registrant_org",
      "registrant country": "registrant_country",
      "name server": "name_servers",
      "status": "status",
    };
    const name_servers: string[] = [];
    const statuses: string[] = [];

    for (const line of raw.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!value) continue;
      const mapped = key_map[key];
      if (mapped === "name_servers") name_servers.push(value.toLowerCase());
      else if (mapped === "status") statuses.push(value.split(" ")[0]);
      else if (mapped) result[mapped] = value;
    }

    return { ...result, name_servers, statuses, registered: !!result.domain_name };
  }
}
