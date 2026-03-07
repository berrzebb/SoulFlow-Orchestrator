/** UUID 도구 — UUID v4/v7 생성 + 파싱/검증. */

import { randomBytes } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class UuidTool extends Tool {
  readonly name = "uuid";
  readonly category = "data" as const;
  readonly description = "UUID operations: generate (v4/v7), parse, validate, batch, nil.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "parse", "validate", "batch", "nil"], description: "UUID operation" },
      version: { type: "integer", enum: [4, 7], description: "UUID version (generate, default: 4)" },
      uuid: { type: "string", description: "UUID string (parse/validate)" },
      count: { type: "integer", description: "Number of UUIDs (batch, default: 5, max: 100)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");

    switch (action) {
      case "generate": {
        const version = Number(params.version) || 4;
        const uuid = version === 7 ? this.uuid_v7() : this.uuid_v4();
        return JSON.stringify({ uuid, version });
      }
      case "parse": {
        const uuid = String(params.uuid || "");
        return this.parse_uuid(uuid);
      }
      case "validate": {
        const uuid = String(params.uuid || "");
        const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
        return JSON.stringify({ valid, uuid });
      }
      case "batch": {
        const count = Math.max(1, Math.min(100, Number(params.count) || 5));
        const version = Number(params.version) || 4;
        const uuids = Array.from({ length: count }, () => version === 7 ? this.uuid_v7() : this.uuid_v4());
        return JSON.stringify({ uuids, count, version });
      }
      case "nil":
        return JSON.stringify({ uuid: "00000000-0000-0000-0000-000000000000" });
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private uuid_v4(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    return this.format_uuid(bytes);
  }

  private uuid_v7(): string {
    const now = Date.now();
    const bytes = randomBytes(16);

    bytes[0] = (now / 2 ** 40) & 0xff;
    bytes[1] = (now / 2 ** 32) & 0xff;
    bytes[2] = (now / 2 ** 24) & 0xff;
    bytes[3] = (now / 2 ** 16) & 0xff;
    bytes[4] = (now / 2 ** 8) & 0xff;
    bytes[5] = now & 0xff;

    bytes[6] = (bytes[6]! & 0x0f) | 0x70;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    return this.format_uuid(bytes);
  }

  private format_uuid(bytes: Buffer): string {
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private parse_uuid(uuid: string): string {
    const clean = uuid.replace(/-/g, "").toLowerCase();
    if (clean.length !== 32 || !/^[0-9a-f]+$/.test(clean)) {
      return JSON.stringify({ valid: false, error: "invalid UUID format" });
    }

    const version = parseInt(clean[12]!, 16);
    const variant_bits = parseInt(clean[16]!, 16);
    let variant = "unknown";
    if ((variant_bits & 0x8) === 0) variant = "NCS";
    else if ((variant_bits & 0xc) === 0x8) variant = "RFC4122";
    else if ((variant_bits & 0xe) === 0xc) variant = "Microsoft";
    else variant = "Future";

    const result: Record<string, unknown> = { uuid, version, variant, valid: true };

    if (version === 7) {
      const timestamp = parseInt(clean.slice(0, 12), 16);
      result.timestamp = timestamp;
      result.date = new Date(timestamp).toISOString();
    }

    if (clean === "0".repeat(32)) {
      result.nil = true;
    }

    return JSON.stringify(result);
  }
}
