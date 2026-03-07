/** Crypto 도구 — AES-256-GCM 암복호화, RSA 서명/검증, 키 생성. */

import { createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync, createSign, createVerify } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class CryptoTool extends Tool {
  readonly name = "crypto";
  readonly category = "security" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Encrypt/decrypt data with AES-256-GCM. Sign/verify with RSA. Actions: encrypt, decrypt, sign, verify, generate_key.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["encrypt", "decrypt", "sign", "verify", "generate_key"], description: "Operation" },
      input: { type: "string", description: "Plaintext (encrypt/sign) or ciphertext hex (decrypt)" },
      key: { type: "string", description: "Hex key (AES: 64 hex) or PEM key (RSA)" },
      iv: { type: "string", description: "Hex IV for AES-GCM decrypt" },
      auth_tag: { type: "string", description: "Hex auth tag for AES-GCM decrypt" },
      signature: { type: "string", description: "Hex signature for RSA verify" },
      key_type: { type: "string", enum: ["aes", "rsa"], description: "generate_key type (default: aes)" },
      key_size: { type: "integer", description: "RSA key bits (2048/4096)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "");
    switch (action) {
      case "generate_key": return this.gen_key(params);
      case "encrypt": return this.encrypt(params);
      case "decrypt": return this.decrypt(params);
      case "sign": return this.sign(params);
      case "verify": return this.verify_sig(params);
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private gen_key(p: Record<string, unknown>): string {
    const t = String(p.key_type || "aes");
    if (t === "aes") return JSON.stringify({ key_type: "aes-256", key: randomBytes(32).toString("hex") });
    if (t === "rsa") {
      const bits = Number(p.key_size || 2048);
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: bits,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      return JSON.stringify({ key_type: `rsa-${bits}`, public_key: publicKey, private_key: privateKey });
    }
    return `Error: unsupported key_type "${t}"`;
  }

  private encrypt(p: Record<string, unknown>): string {
    const input = String(p.input ?? "");
    const key = String(p.key || "");
    if (key.length !== 64) return "Error: key must be 64 hex chars (AES-256)";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    let ct = cipher.update(input, "utf8", "hex");
    ct += cipher.final("hex");
    return JSON.stringify({ ciphertext: ct, iv: iv.toString("hex"), auth_tag: cipher.getAuthTag().toString("hex"), algorithm: "aes-256-gcm" });
  }

  private decrypt(p: Record<string, unknown>): string {
    const key = String(p.key || ""), iv = String(p.iv || ""), tag = String(p.auth_tag || ""), ct = String(p.input ?? "");
    if (key.length !== 64) return "Error: key must be 64 hex chars";
    if (!iv || !tag) return "Error: iv and auth_tag are required";
    try {
      const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
      d.setAuthTag(Buffer.from(tag, "hex"));
      let pt = d.update(ct, "hex", "utf8");
      pt += d.final("utf8");
      return JSON.stringify({ plaintext: pt });
    } catch { return "Error: decryption failed"; }
  }

  private sign(p: Record<string, unknown>): string {
    const input = String(p.input ?? ""), key = String(p.key || "");
    if (!key.includes("PRIVATE KEY")) return "Error: PEM private key required";
    try {
      const s = createSign("SHA256"); s.update(input);
      return JSON.stringify({ signature: s.sign(key, "hex"), algorithm: "RSA-SHA256" });
    } catch { return "Error: signing failed"; }
  }

  private verify_sig(p: Record<string, unknown>): string {
    const input = String(p.input ?? ""), key = String(p.key || ""), sig = String(p.signature || "");
    if (!key.includes("PUBLIC KEY")) return "Error: PEM public key required";
    if (!sig) return "Error: signature required";
    try {
      const v = createVerify("SHA256"); v.update(input);
      return JSON.stringify({ valid: v.verify(key, sig, "hex") });
    } catch { return "Error: verification failed"; }
  }
}
