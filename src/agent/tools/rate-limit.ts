/** Rate Limit 도구 — 토큰 버킷/슬라이딩 윈도우 속도 제한. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

interface BucketState {
  tokens: number;
  last_refill: number;
  max_tokens: number;
  refill_rate: number;
  window_ms: number;
  requests: number[];
}

const buckets = new Map<string, BucketState>();
const MAX_BUCKETS = 100;

export class RateLimitTool extends Tool {
  readonly name = "rate_limit";
  readonly category = "data" as const;
  readonly description = "Rate limiting: check, consume, status, reset. Token bucket and sliding window algorithms.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["check", "consume", "status", "reset", "list"], description: "Rate limit operation" },
      key: { type: "string", description: "Rate limit bucket identifier" },
      max_requests: { type: "integer", description: "Max requests per window (default: 60)" },
      window_ms: { type: "integer", description: "Time window in ms (default: 60000 = 1min)" },
      tokens: { type: "integer", description: "Tokens to consume (default: 1)" },
      algorithm: { type: "string", enum: ["token_bucket", "sliding_window"], description: "Algorithm (default: token_bucket)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "check");

    switch (action) {
      case "check": return this.check(params);
      case "consume": return this.consume(params);
      case "status": return this.status(params);
      case "reset": return this.reset(params);
      case "list": return this.list();
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private get_or_create(key: string, max_req: number, window_ms: number): BucketState {
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = [...buckets.entries()].sort((a, b) => a[1].last_refill - b[1].last_refill)[0];
        if (oldest) buckets.delete(oldest[0]);
      }
      bucket = {
        tokens: max_req,
        last_refill: Date.now(),
        max_tokens: max_req,
        refill_rate: max_req / window_ms,
        window_ms,
        requests: [],
      };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState): void {
    const now = Date.now();
    const elapsed = now - bucket.last_refill;
    bucket.tokens = Math.min(bucket.max_tokens, bucket.tokens + elapsed * bucket.refill_rate);
    bucket.last_refill = now;
    bucket.requests = bucket.requests.filter((t) => now - t < bucket.window_ms);
  }

  private check(params: Record<string, unknown>): string {
    const key = String(params.key || "default");
    const max_req = Math.max(1, Number(params.max_requests) || 60);
    const window_ms = Math.max(1000, Number(params.window_ms) || 60000);
    const tokens = Math.max(1, Number(params.tokens) || 1);
    const algo = String(params.algorithm || "token_bucket");

    const bucket = this.get_or_create(key, max_req, window_ms);
    this.refill(bucket);

    const allowed = algo === "sliding_window"
      ? bucket.requests.length + tokens <= max_req
      : bucket.tokens >= tokens;

    const remaining = algo === "sliding_window"
      ? Math.max(0, max_req - bucket.requests.length)
      : Math.floor(bucket.tokens);

    return JSON.stringify({ allowed, remaining, key, max: max_req, window_ms });
  }

  private consume(params: Record<string, unknown>): string {
    const key = String(params.key || "default");
    const max_req = Math.max(1, Number(params.max_requests) || 60);
    const window_ms = Math.max(1000, Number(params.window_ms) || 60000);
    const tokens = Math.max(1, Number(params.tokens) || 1);
    const algo = String(params.algorithm || "token_bucket");

    const bucket = this.get_or_create(key, max_req, window_ms);
    this.refill(bucket);

    if (algo === "sliding_window") {
      if (bucket.requests.length + tokens > max_req) {
        const retry_after = bucket.requests.length > 0
          ? bucket.window_ms - (Date.now() - bucket.requests[0]!)
          : 0;
        return JSON.stringify({ consumed: false, remaining: Math.max(0, max_req - bucket.requests.length), retry_after_ms: Math.max(0, retry_after) });
      }
      const now = Date.now();
      for (let i = 0; i < tokens; i++) bucket.requests.push(now);
      return JSON.stringify({ consumed: true, remaining: max_req - bucket.requests.length });
    }

    if (bucket.tokens < tokens) {
      const deficit = tokens - bucket.tokens;
      const retry_after = Math.ceil(deficit / bucket.refill_rate);
      return JSON.stringify({ consumed: false, remaining: Math.floor(bucket.tokens), retry_after_ms: retry_after });
    }

    bucket.tokens -= tokens;
    return JSON.stringify({ consumed: true, remaining: Math.floor(bucket.tokens) });
  }

  private status(params: Record<string, unknown>): string {
    const key = String(params.key || "default");
    const bucket = buckets.get(key);
    if (!bucket) return JSON.stringify({ exists: false, key });
    this.refill(bucket);
    return JSON.stringify({
      key,
      exists: true,
      remaining: Math.floor(bucket.tokens),
      max: bucket.max_tokens,
      window_ms: bucket.window_ms,
      recent_requests: bucket.requests.length,
    });
  }

  private reset(params: Record<string, unknown>): string {
    const key = String(params.key || "default");
    if (key === "*") { const count = buckets.size; buckets.clear(); return JSON.stringify({ reset: true, count }); }
    const deleted = buckets.delete(key);
    return JSON.stringify({ reset: deleted, key });
  }

  private list(): string {
    const items = [...buckets.entries()].map(([key, b]) => ({
      key, remaining: Math.floor(b.tokens), max: b.max_tokens, window_ms: b.window_ms,
    }));
    return JSON.stringify({ buckets: items, count: items.length });
  }
}
