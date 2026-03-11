/** DNS 도구 — DNS lookup/reverse/MX/TXT 조회. */

import { promises as dns } from "node:dns";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

export class DnsTool extends Tool {
  readonly name = "dns";
  readonly category = "external" as const;
  readonly description = "DNS operations: lookup, reverse, mx, txt, ns, cname, srv, any.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["lookup", "reverse", "mx", "txt", "ns", "cname", "srv", "any"], description: "DNS query type" },
      host: { type: "string", description: "Hostname or IP address" },
      family: { type: "integer", enum: [4, 6], description: "IP family (4 or 6, for lookup)" },
    },
    required: ["action", "host"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "lookup");
    const host = String(params.host || "");
    if (!host) return "Error: host is required";

    try {
      switch (action) {
        case "lookup": {
          const family = Number(params.family) || 0;
          const result = await dns.lookup(host, { all: true, family: family as 0 | 4 | 6 });
          return JSON.stringify({ host, addresses: result });
        }
        case "reverse": {
          const hostnames = await dns.reverse(host);
          return JSON.stringify({ ip: host, hostnames });
        }
        case "mx": {
          const records = await dns.resolveMx(host);
          return JSON.stringify({ host, mx: records.sort((a, b) => a.priority - b.priority) });
        }
        case "txt": {
          const records = await dns.resolveTxt(host);
          return JSON.stringify({ host, txt: records.map((r) => r.join("")) });
        }
        case "ns": {
          const records = await dns.resolveNs(host);
          return JSON.stringify({ host, ns: records });
        }
        case "cname": {
          const records = await dns.resolveCname(host);
          return JSON.stringify({ host, cname: records });
        }
        case "srv": {
          const records = await dns.resolveSrv(host);
          return JSON.stringify({ host, srv: records });
        }
        case "any": {
          const records = await dns.resolveAny(host);
          return JSON.stringify({ host, records });
        }
        default:
          return `Error: unsupported action "${action}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }
}
