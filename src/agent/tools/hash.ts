/** Hash 도구 — MD5/SHA-256/SHA-512/HMAC 해시 계산. */

import { createHash, createHmac } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const ALGORITHMS = ["md5", "sha1", "sha256", "sha384", "sha512"] as const;
type Algorithm = typeof ALGORITHMS[number];

export class HashTool extends Tool {
  readonly name = "hash";
  readonly category = "security" as const;
  readonly description = "Compute hashes: MD5, SHA-256, SHA-512, HMAC. Actions: hash, hmac, verify.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["hash", "hmac", "verify"], description: "Operation" },
      input: { type: "string", description: "Input string to hash" },
      algorithm: { type: "string", enum: [...ALGORITHMS], description: "Hash algorithm (default: sha256)" },
      key: { type: "string", description: "HMAC secret key (required for hmac action)" },
      encoding: { type: "string", enum: ["hex", "base64", "base64url"], description: "Output encoding (default: hex)" },
      expected: { type: "string", description: "Expected hash for verify action" },
    },
    required: ["action", "input"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "hash");
    const input = String(params.input ?? "");
    const algo = (String(params.algorithm || "sha256").toLowerCase()) as Algorithm;
    const encoding = (String(params.encoding || "hex")) as "hex" | "base64" | "base64url";

    if (!ALGORITHMS.includes(algo)) return `Error: unsupported algorithm "${algo}". Use: ${ALGORITHMS.join(", ")}`;

    if (action === "hash") {
      const digest = createHash(algo).update(input).digest(encoding);
      return JSON.stringify({ algorithm: algo, encoding, digest });
    }

    if (action === "hmac") {
      const key = String(params.key || "");
      if (!key) return "Error: key is required for hmac";
      const digest = createHmac(algo, key).update(input).digest(encoding);
      return JSON.stringify({ algorithm: algo, encoding, digest });
    }

    if (action === "verify") {
      const expected = String(params.expected || "");
      if (!expected) return "Error: expected hash is required for verify";
      const key = String(params.key || "");
      const digest = key
        ? createHmac(algo, key).update(input).digest(encoding)
        : createHash(algo).update(input).digest(encoding);
      const match = digest === expected;
      return JSON.stringify({ match, algorithm: algo, digest, expected });
    }

    return `Error: unsupported action "${action}"`;
  }
}
