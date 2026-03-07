/** Checksum 도구 — 파일 무결성 검증 (adler32, crc32, sha256, hmac). */

import { createHash, createHmac } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

function adler32(data: Buffer): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = (CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class ChecksumTool extends Tool {
  readonly name = "checksum";
  readonly category = "data" as const;
  readonly description = "File integrity: adler32, crc32, sha256, verify, compare, manifest, hmac.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["adler32", "crc32", "sha256", "verify", "compare", "manifest", "hmac"], description: "Operation" },
      data: { type: "string", description: "Input data (text or base64)" },
      expected: { type: "string", description: "Expected checksum for verify" },
      algorithm: { type: "string", description: "Hash algorithm (default: sha256)" },
      key: { type: "string", description: "HMAC key" },
      entries: { type: "string", description: "JSON array of {name, data} for manifest" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "sha256");
    const data = Buffer.from(String(params.data || ""), "utf-8");

    switch (action) {
      case "adler32": {
        const v = adler32(data);
        return JSON.stringify({ algorithm: "adler32", checksum: v.toString(16).padStart(8, "0"), decimal: v });
      }
      case "crc32": {
        const v = crc32(data);
        return JSON.stringify({ algorithm: "crc32", checksum: v.toString(16).padStart(8, "0"), decimal: v });
      }
      case "sha256": {
        const algo = String(params.algorithm || "sha256");
        const hash = createHash(algo).update(data).digest("hex");
        return JSON.stringify({ algorithm: algo, checksum: hash, size: data.length });
      }
      case "verify": {
        const expected = String(params.expected || "");
        const algo = String(params.algorithm || "sha256");
        let actual: string;
        if (algo === "adler32") actual = adler32(data).toString(16).padStart(8, "0");
        else if (algo === "crc32") actual = crc32(data).toString(16).padStart(8, "0");
        else actual = createHash(algo).update(data).digest("hex");
        const match = actual.toLowerCase() === expected.toLowerCase();
        return JSON.stringify({ algorithm: algo, expected, actual, match });
      }
      case "compare": {
        const algo = String(params.algorithm || "sha256");
        const entries_raw = String(params.entries || "[]");
        let entries: { name: string; data: string }[];
        try { entries = JSON.parse(entries_raw); } catch { return JSON.stringify({ error: "invalid entries JSON" }); }
        const hashes = entries.map((e) => ({
          name: e.name,
          checksum: createHash(algo).update(Buffer.from(e.data, "utf-8")).digest("hex"),
        }));
        const all_match = hashes.length > 1 && hashes.every((h) => h.checksum === hashes[0].checksum);
        return JSON.stringify({ algorithm: algo, entries: hashes, all_match });
      }
      case "manifest": {
        const algo = String(params.algorithm || "sha256");
        const entries_raw = String(params.entries || "[]");
        let entries: { name: string; data: string }[];
        try { entries = JSON.parse(entries_raw); } catch { return JSON.stringify({ error: "invalid entries JSON" }); }
        const lines = entries.map((e) => {
          const hash = createHash(algo).update(Buffer.from(e.data, "utf-8")).digest("hex");
          return { name: e.name, checksum: hash };
        });
        const manifest_text = lines.map((l) => `${l.checksum}  ${l.name}`).join("\n");
        return JSON.stringify({ algorithm: algo, entries: lines, manifest: manifest_text });
      }
      case "hmac": {
        const key = String(params.key || "");
        if (!key) return JSON.stringify({ error: "key is required" });
        const algo = String(params.algorithm || "sha256");
        const hmac = createHmac(algo, key).update(data).digest("hex");
        return JSON.stringify({ algorithm: `hmac-${algo}`, checksum: hmac, size: data.length });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }
}
