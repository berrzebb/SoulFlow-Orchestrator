/** TTL Cache 도구 — TTL 기반 키-값 캐시. LRU eviction. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const MAX_ENTRIES = 500;
const MAX_VALUE_SIZE = 1024 * 256;
const DEFAULT_TTL_MS = 300_000;

type CacheEntry = { value: string; expires_at: number; created_at: number; hits: number };

export class CacheTool extends Tool {
  readonly name = "ttl_cache";
  readonly category = "memory" as const;
  readonly description =
    "TTL-based key-value cache with LRU eviction. Operations: set, get, invalidate, has, keys, stats, clear.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["set", "get", "invalidate", "has", "keys", "stats", "clear"], description: "Cache operation" },
      key: { type: "string", description: "Cache key" },
      value: { type: "string", description: "Value to cache (for set)" },
      ttl_ms: { type: "integer", minimum: 0, maximum: 86400000, description: "TTL in ms (default: 300000 = 5min). 0 = permanent (no expiration)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly store = new Map<string, CacheEntry>();
  private total_hits = 0;
  private total_misses = 0;

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "get");
    const key = String(params.key || "").trim();

    this.evict_expired();

    switch (op) {
      case "set": {
        if (!key) return "Error: key is required";
        const value = String(params.value ?? "");
        if (value.length > MAX_VALUE_SIZE) return `Error: value exceeds ${MAX_VALUE_SIZE} bytes`;
        const ttl_raw = params.ttl_ms !== undefined ? Number(params.ttl_ms) : DEFAULT_TTL_MS;
        const ttl = Math.max(0, ttl_raw);
        if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) this.evict_lru();
        const expires_at = ttl === 0 ? Infinity : Date.now() + ttl;
        this.store.set(key, { value, expires_at, created_at: Date.now(), hits: 0 });
        return `Cached "${key}" (ttl: ${ttl === 0 ? "permanent" : `${ttl}ms`}, size: ${this.store.size})`;
      }

      case "get": {
        if (!key) return "Error: key is required";
        const entry = this.store.get(key);
        if (!entry || entry.expires_at < Date.now()) {
          this.total_misses++;
          if (entry) this.store.delete(key);
          return `Error: cache miss — key "${key}" not found or expired`;
        }
        entry.hits++;
        this.total_hits++;
        return entry.value;
      }

      case "invalidate": {
        if (!key) return "Error: key is required";
        return this.store.delete(key) ? `Invalidated "${key}"` : `Key "${key}" not found`;
      }

      case "has": {
        if (!key) return "Error: key is required";
        const entry = this.store.get(key);
        const exists = !!entry && entry.expires_at >= Date.now();
        return JSON.stringify({ key, exists });
      }

      case "keys":
        return JSON.stringify([...this.store.keys()]);

      case "stats": {
        const now = Date.now();
        let expired = 0;
        for (const e of this.store.values()) { if (e.expires_at < now) expired++; }
        return JSON.stringify({
          total_entries: this.store.size,
          active: this.store.size - expired,
          expired,
          total_hits: this.total_hits,
          total_misses: this.total_misses,
          hit_rate: this.total_hits + this.total_misses > 0
            ? `${Math.round((this.total_hits / (this.total_hits + this.total_misses)) * 100)}%`
            : "N/A",
        }, null, 2);
      }

      case "clear": {
        const count = this.store.size;
        this.store.clear();
        this.total_hits = 0;
        this.total_misses = 0;
        return `Cleared ${count} entries`;
      }

      default:
        return `Error: unsupported operation "${op}"`;
    }
  }

  private evict_expired(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expires_at < now) this.store.delete(k);
    }
  }

  private evict_lru(): void {
    let oldest_key = "";
    let oldest_time = Infinity;
    for (const [k, v] of this.store) {
      if (v.created_at < oldest_time) { oldest_time = v.created_at; oldest_key = k; }
    }
    if (oldest_key) this.store.delete(oldest_key);
  }
}
