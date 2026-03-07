/** IP 도구 — IP 주소 파싱/검증/CIDR/서브넷/사설망 판별. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class IpTool extends Tool {
  readonly name = "ip";
  readonly category = "data" as const;
  readonly description = "IP address utilities: parse, validate, cidr_contains, subnet, is_private, is_v6, range, to_int, from_int.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "validate", "cidr_contains", "subnet", "is_private", "is_v6", "range", "to_int", "from_int"], description: "IP operation" },
      ip: { type: "string", description: "IP address" },
      cidr: { type: "string", description: "CIDR notation (e.g. 192.168.1.0/24)" },
      start: { type: "string", description: "Start IP for range" },
      end: { type: "string", description: "End IP for range" },
      value: { type: "integer", description: "Integer value for from_int" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const ip = String(params.ip || "");
        const v6 = ip.includes(":");
        if (v6) {
          const expanded = this.expand_v6(ip);
          if (!expanded) return JSON.stringify({ error: "invalid IPv6" });
          return JSON.stringify({ ip, version: 6, expanded, is_private: this.is_private_v6(expanded) });
        }
        const parts = ip.split(".").map(Number);
        if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
          return JSON.stringify({ error: "invalid IPv4" });
        }
        return JSON.stringify({ ip, version: 4, octets: parts, integer: this.ip4_to_int(parts), is_private: this.is_private_v4(parts) });
      }
      case "validate": {
        const ip = String(params.ip || "");
        const v4_valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((o) => Number(o) >= 0 && Number(o) <= 255);
        const v6_valid = !!this.expand_v6(ip);
        return JSON.stringify({ valid: v4_valid || v6_valid, version: v4_valid ? 4 : v6_valid ? 6 : null });
      }
      case "cidr_contains": {
        const cidr = String(params.cidr || "");
        const ip = String(params.ip || "");
        const [net_ip, prefix_str] = cidr.split("/");
        if (!net_ip || !prefix_str) return "Error: cidr must be in format x.x.x.x/n";
        const prefix = Number(prefix_str);
        const net_parts = net_ip.split(".").map(Number);
        const ip_parts = ip.split(".").map(Number);
        if (net_parts.length !== 4 || ip_parts.length !== 4) return "Error: only IPv4 CIDR supported";
        const net_int = this.ip4_to_int(net_parts);
        const ip_int = this.ip4_to_int(ip_parts);
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        const contains = (net_int & mask) === (ip_int & mask);
        return JSON.stringify({ contains, cidr, ip });
      }
      case "subnet": {
        const cidr = String(params.cidr || "");
        const [net_ip, prefix_str] = cidr.split("/");
        if (!net_ip || !prefix_str) return "Error: cidr required";
        const prefix = Number(prefix_str);
        const parts = net_ip.split(".").map(Number);
        const net_int = this.ip4_to_int(parts);
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        const network = (net_int & mask) >>> 0;
        const broadcast = (network | (~mask >>> 0)) >>> 0;
        const host_count = Math.max(0, (broadcast - network - 1));
        return JSON.stringify({
          network: this.int_to_ip4(network),
          broadcast: this.int_to_ip4(broadcast),
          netmask: this.int_to_ip4(mask),
          first_host: prefix < 31 ? this.int_to_ip4(network + 1) : this.int_to_ip4(network),
          last_host: prefix < 31 ? this.int_to_ip4(broadcast - 1) : this.int_to_ip4(broadcast),
          host_count: prefix <= 30 ? host_count : prefix === 31 ? 2 : 1,
          prefix,
        });
      }
      case "is_private": {
        const ip = String(params.ip || "");
        const parts = ip.split(".").map(Number);
        return JSON.stringify({ ip, is_private: this.is_private_v4(parts) });
      }
      case "is_v6": {
        const ip = String(params.ip || "");
        return JSON.stringify({ ip, is_v6: ip.includes(":") && !!this.expand_v6(ip) });
      }
      case "range": {
        const start = String(params.start || params.ip || "");
        const end = String(params.end || "");
        if (!start || !end) return "Error: start and end are required";
        const s = this.ip4_to_int(start.split(".").map(Number));
        const e = this.ip4_to_int(end.split(".").map(Number));
        const count = e - s + 1;
        const ips: string[] = [];
        for (let i = 0; i < Math.min(count, 256); i++) ips.push(this.int_to_ip4(s + i));
        return JSON.stringify({ ips, count, truncated: count > 256 });
      }
      case "to_int": {
        const ip = String(params.ip || "");
        const parts = ip.split(".").map(Number);
        return JSON.stringify({ ip, integer: this.ip4_to_int(parts) });
      }
      case "from_int": {
        const val = Number(params.value) || 0;
        return JSON.stringify({ ip: this.int_to_ip4(val >>> 0), integer: val });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private ip4_to_int(parts: number[]): number {
    return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  }

  private int_to_ip4(n: number): string {
    return `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`;
  }

  private is_private_v4(parts: number[]): boolean {
    return parts[0] === 10 ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127;
  }

  private is_private_v6(expanded: string): boolean {
    return expanded.startsWith("fc") || expanded.startsWith("fd") || expanded === "0000:0000:0000:0000:0000:0000:0000:0001";
  }

  private expand_v6(ip: string): string | null {
    if (!ip.includes(":")) return null;
    const parts = ip.split("::");
    if (parts.length > 2) return null;
    const left = parts[0]!.split(":").filter(Boolean);
    const right = parts.length === 2 ? parts[1]!.split(":").filter(Boolean) : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const middle = Array(missing).fill("0000");
    const full = [...left, ...middle, ...right].map((g) => g.padStart(4, "0"));
    if (full.length !== 8) return null;
    return full.join(":");
  }
}
