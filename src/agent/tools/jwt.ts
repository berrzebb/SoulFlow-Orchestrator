/** JWT 도구 — JWT 생성/검증/디코딩. HS256/HS384/HS512 지원. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const SUPPORTED_ALGS = ["HS256", "HS384", "HS512"] as const;
const ALG_MAP: Record<string, string> = { HS256: "sha256", HS384: "sha384", HS512: "sha512" };

function b64url_encode(buf: Buffer): string { return buf.toString("base64url"); }
function b64url_decode(s: string): Buffer { return Buffer.from(s, "base64url"); }

export class JwtTool extends Tool {
  readonly name = "jwt";
  readonly category = "security" as const;
  readonly description = "JWT operations: create, verify, decode tokens. Supports HS256, HS384, HS512.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "verify", "decode"], description: "Operation" },
      token: { type: "string", description: "JWT token string (verify/decode)" },
      payload: { type: "string", description: "JSON payload string (create)" },
      secret: { type: "string", description: "HMAC secret (create/verify)" },
      algorithm: { type: "string", enum: [...SUPPORTED_ALGS], description: "Algorithm (default: HS256)" },
      expires_in: { type: "string", description: "Expiration like '1h', '30m', '7d' (create)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "");
    switch (action) {
      case "create": return this.create(params);
      case "verify": return this.verify(params);
      case "decode": return this.decode(params);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private create(p: Record<string, unknown>): string {
    const secret = String(p.secret || "");
    if (!secret) return "Error: secret is required";
    const alg = String(p.algorithm || "HS256") as typeof SUPPORTED_ALGS[number];
    if (!SUPPORTED_ALGS.includes(alg)) return `Error: unsupported algorithm "${alg}"`;

    let payload: Record<string, unknown>;
    try { payload = JSON.parse(String(p.payload || "{}")); } catch { return "Error: invalid JSON payload"; }

    const now = Math.floor(Date.now() / 1000);
    payload.iat = now;
    const expires_in = String(p.expires_in || "").trim();
    if (expires_in) {
      const exp_s = this.parse_duration(expires_in);
      if (!exp_s) return `Error: invalid expires_in "${expires_in}"`;
      payload.exp = now + exp_s;
    }

    const header = b64url_encode(Buffer.from(JSON.stringify({ alg, typ: "JWT" })));
    const body = b64url_encode(Buffer.from(JSON.stringify(payload)));
    const sig = this.sign(`${header}.${body}`, secret, alg);
    return JSON.stringify({ token: `${header}.${body}.${sig}`, payload });
  }

  private verify(p: Record<string, unknown>): string {
    const token = String(p.token || "");
    const secret = String(p.secret || "");
    if (!token || !secret) return "Error: token and secret are required";

    const parts = token.split(".");
    if (parts.length !== 3) return "Error: invalid JWT format";

    let header: Record<string, unknown>, payload: Record<string, unknown>;
    try {
      header = JSON.parse(b64url_decode(parts[0]!).toString());
      payload = JSON.parse(b64url_decode(parts[1]!).toString());
    } catch { return "Error: malformed JWT"; }

    const alg = String(header.alg || "HS256") as typeof SUPPORTED_ALGS[number];
    if (!ALG_MAP[alg]) return `Error: unsupported algorithm "${alg}"`;

    const expected_sig = this.sign(`${parts[0]}.${parts[1]}`, secret, alg);
    const sig_valid = timingSafeEqual(Buffer.from(expected_sig), Buffer.from(parts[2]!));

    const now = Math.floor(Date.now() / 1000);
    const expired = typeof payload.exp === "number" && payload.exp < now;

    return JSON.stringify({ valid: sig_valid && !expired, sig_valid, expired, payload });
  }

  private decode(p: Record<string, unknown>): string {
    const token = String(p.token || "");
    const parts = token.split(".");
    if (parts.length !== 3) return "Error: invalid JWT format";
    try {
      const header = JSON.parse(b64url_decode(parts[0]!).toString());
      const payload = JSON.parse(b64url_decode(parts[1]!).toString());
      return JSON.stringify({ header, payload }, null, 2);
    } catch { return "Error: malformed JWT"; }
  }

  private sign(data: string, secret: string, alg: string): string {
    return createHmac(ALG_MAP[alg]!, secret).update(data).digest("base64url");
  }

  private parse_duration(s: string): number | null {
    const m = s.match(/^(\d+)\s*([smhd])$/);
    if (!m) return null;
    const n = Number(m[1]);
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (units[m[2]!] || 0);
  }
}
