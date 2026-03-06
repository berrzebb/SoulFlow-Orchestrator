/** Encoding 도구 — Base64/Hex/URL 인코딩·디코딩 + SHA/MD5 해시 + UUID 생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { createHash, randomUUID } from "node:crypto";

export class EncodingTool extends Tool {
  readonly name = "encoding";
  readonly category = "memory" as const;
  readonly description =
    "Encode/decode (Base64, Hex, URL), generate hashes (SHA-256, SHA-512, MD5), and create UUIDs.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["encode", "decode", "hash", "uuid"],
        description: "Operation to perform",
      },
      input: { type: "string", description: "Input string" },
      format: {
        type: "string",
        enum: ["base64", "hex", "url", "sha256", "sha512", "md5"],
        description: "Encoding/hash format",
      },
      count: { type: "integer", minimum: 1, maximum: 100, description: "Number of UUIDs to generate (for uuid)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "encode");
    const input = String(params.input ?? "");
    const format = String(params.format || "base64");

    switch (op) {
      case "encode": return this.encode(input, format);
      case "decode": return this.decode(input, format);
      case "hash": return this.hash(input, format);
      case "uuid": return this.gen_uuid(Number(params.count || 1));
      default: return `Error: unsupported operation "${op}"`;
    }
  }

  private encode(input: string, format: string): string {
    if (!input) return "Error: input is required";
    switch (format) {
      case "base64": return Buffer.from(input, "utf-8").toString("base64");
      case "hex": return Buffer.from(input, "utf-8").toString("hex");
      case "url": return encodeURIComponent(input);
      default: return `Error: unsupported encode format "${format}"`;
    }
  }

  private decode(input: string, format: string): string {
    if (!input) return "Error: input is required";
    try {
      switch (format) {
        case "base64": return Buffer.from(input, "base64").toString("utf-8");
        case "hex": return Buffer.from(input, "hex").toString("utf-8");
        case "url": return decodeURIComponent(input);
        default: return `Error: unsupported decode format "${format}"`;
      }
    } catch {
      return `Error: failed to decode — invalid ${format} input`;
    }
  }

  private hash(input: string, format: string): string {
    if (!input) return "Error: input is required";
    const algo = format === "sha256" ? "sha256" : format === "sha512" ? "sha512" : format === "md5" ? "md5" : null;
    if (!algo) return `Error: unsupported hash format "${format}". Use sha256, sha512, or md5`;
    return createHash(algo).update(input, "utf-8").digest("hex");
  }

  private gen_uuid(count: number): string {
    const n = Math.min(100, Math.max(1, count));
    if (n === 1) return randomUUID();
    return Array.from({ length: n }, () => randomUUID()).join("\n");
  }
}
