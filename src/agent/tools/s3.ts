/** S3 도구 — S3호환 오브젝트 스토리지 (AWS S3 / MinIO / R2 등). */

import { readFile, writeFile } from "node:fs/promises";
import { createHmac, createHash } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class S3Tool extends Tool {
  readonly name = "s3";
  readonly category = "external" as const;
  readonly description = "S3-compatible object storage: list, get, put, delete, presign, head.";
  readonly policy_flags = { network: true, write: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "get", "put", "delete", "head", "presign"], description: "S3 operation" },
      bucket: { type: "string", description: "Bucket name" },
      key: { type: "string", description: "Object key (path)" },
      endpoint: { type: "string", description: "S3 endpoint URL (default: AWS)" },
      region: { type: "string", description: "AWS region (default: us-east-1)" },
      access_key: { type: "string", description: "AWS access key ID" },
      secret_key: { type: "string", description: "AWS secret access key" },
      local_path: { type: "string", description: "Local file path (get/put)" },
      body: { type: "string", description: "String content to upload (put, alternative to local_path)" },
      prefix: { type: "string", description: "Key prefix for listing" },
      max_keys: { type: "integer", description: "Max results for list (default: 100)" },
      expires_in: { type: "integer", description: "Presign URL expiry in seconds (default: 3600)" },
    },
    required: ["action", "bucket"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "list");
    const bucket = String(params.bucket || "");
    const key = String(params.key || "");
    const region = String(params.region || "us-east-1");
    const endpoint = String(params.endpoint || `https://s3.${region}.amazonaws.com`);
    const access_key = String(params.access_key || process.env.AWS_ACCESS_KEY_ID || "");
    const secret_key = String(params.secret_key || process.env.AWS_SECRET_ACCESS_KEY || "");

    if (!bucket) return "Error: bucket is required";
    if (!access_key || !secret_key) return "Error: access_key and secret_key required (or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)";

    try {
      switch (action) {
        case "list": {
          const prefix = String(params.prefix || "");
          const max = Math.min(Number(params.max_keys) || 100, 1000);
          const url = `${endpoint}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${max}`;
          const resp = await this.s3_fetch("GET", url, region, access_key, secret_key);
          return resp;
        }
        case "get": {
          const url = `${endpoint}/${bucket}/${key}`;
          const resp = await this.s3_fetch("GET", url, region, access_key, secret_key);
          if (params.local_path) {
            await writeFile(String(params.local_path), resp);
            return JSON.stringify({ success: true, path: params.local_path, size: resp.length });
          }
          return resp.slice(0, 50000);
        }
        case "put": {
          let body_buf: Buffer;
          if (params.local_path) {
            body_buf = await readFile(String(params.local_path));
          } else {
            body_buf = Buffer.from(String(params.body || ""));
          }
          const url = `${endpoint}/${bucket}/${key}`;
          await this.s3_fetch("PUT", url, region, access_key, secret_key, body_buf);
          return JSON.stringify({ success: true, key, size: body_buf.length });
        }
        case "delete": {
          const url = `${endpoint}/${bucket}/${key}`;
          await this.s3_fetch("DELETE", url, region, access_key, secret_key);
          return JSON.stringify({ success: true, deleted: key });
        }
        case "head": {
          const url = `${endpoint}/${bucket}/${key}`;
          const resp = await this.s3_fetch("HEAD", url, region, access_key, secret_key);
          return resp;
        }
        case "presign": {
          const expires = Number(params.expires_in) || 3600;
          return JSON.stringify({
            note: "Presigned URL generation requires AWS SDK. Use the endpoint + bucket + key pattern.",
            url: `${endpoint}/${bucket}/${key}`,
            expires_in: expires,
          });
        }
        default:
          return `Error: unsupported action "${action}"`;
      }
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  private async s3_fetch(method: string, url: string, region: string, access_key: string, secret_key: string, body?: Buffer): Promise<string> {
    const parsed = new URL(url);
    const now = new Date();
    const date_stamp = now.toISOString().replace(/[-:]/g, "").split(".")[0]! + "Z";
    const day_stamp = date_stamp.slice(0, 8);
    const host = parsed.host;

    const payload_hash = createHash("sha256").update(body || "").digest("hex");
    const headers: Record<string, string> = {
      host,
      "x-amz-date": date_stamp,
      "x-amz-content-sha256": payload_hash,
    };

    const signed_headers = Object.keys(headers).sort().join(";");
    const canonical_headers = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
    const canonical = [method, parsed.pathname, parsed.search.slice(1), canonical_headers, signed_headers, payload_hash].join("\n");

    const scope = `${day_stamp}/${region}/s3/aws4_request`;
    const string_to_sign = ["AWS4-HMAC-SHA256", date_stamp, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");

    const k_date = createHmac("sha256", `AWS4${secret_key}`).update(day_stamp).digest();
    const k_region = createHmac("sha256", k_date).update(region).digest();
    const k_service = createHmac("sha256", k_region).update("s3").digest();
    const k_signing = createHmac("sha256", k_service).update("aws4_request").digest();
    const signature = createHmac("sha256", k_signing).update(string_to_sign).digest("hex");

    const auth = `AWS4-HMAC-SHA256 Credential=${access_key}/${scope}, SignedHeaders=${signed_headers}, Signature=${signature}`;

    const resp = await fetch(url, {
      method,
      headers: { ...headers, Authorization: auth, ...(body ? { "Content-Length": String(body.length) } : {}) },
      body: body ? new Uint8Array(body) : undefined,
    });

    if (method === "HEAD") {
      const meta: Record<string, string> = {};
      resp.headers.forEach((v, k) => { meta[k] = v; });
      return JSON.stringify({ status: resp.status, headers: meta });
    }

    if (!resp.ok && method !== "DELETE") {
      const text = await resp.text();
      throw new Error(`S3 ${resp.status}: ${text.slice(0, 500)}`);
    }

    return await resp.text();
  }
}
