/** BloomFilter 도구 — 확률적 집합 소속 테스트. */

import { createHash } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class BloomFilterTool extends Tool {
  readonly name = "bloom_filter";
  readonly category = "data" as const;
  readonly description = "Bloom filter: create, add, test, stats, merge, serialize, estimate_size.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "add", "test", "stats", "merge", "serialize", "estimate_size"], description: "Operation" },
      size: { type: "number", description: "Bit array size (default: 1024)" },
      hash_count: { type: "number", description: "Number of hash functions (default: 3)" },
      filter: { type: "string", description: "Hex-encoded filter state" },
      filter2: { type: "string", description: "Second filter for merge" },
      items: { type: "string", description: "JSON array of items to add/test" },
      item: { type: "string", description: "Single item to add/test" },
      expected_items: { type: "number", description: "Expected number of items (estimate_size)" },
      false_positive_rate: { type: "number", description: "Target FP rate (estimate_size, default: 0.01)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "create");
    const size = Math.max(8, Math.min(1_000_000, Number(params.size) || 1024));
    const hash_count = Math.max(1, Math.min(20, Number(params.hash_count) || 3));

    switch (action) {
      case "create": {
        const bits = Buffer.alloc(Math.ceil(size / 8)).toString("hex");
        return JSON.stringify({ size, hash_count, filter: bits, bit_count: 0 });
      }
      case "add": {
        const bits = this.decode_bits(String(params.filter || ""), size);
        const items = this.get_items(params);
        let added = 0;
        for (const item of items) {
          const positions = this.hash_positions(String(item), hash_count, size);
          let is_new = false;
          for (const pos of positions) {
            if (!this.get_bit(bits, pos)) is_new = true;
            this.set_bit(bits, pos);
          }
          if (is_new) added++;
        }
        return JSON.stringify({ filter: bits.toString("hex"), added, total_items: items.length });
      }
      case "test": {
        const bits = this.decode_bits(String(params.filter || ""), size);
        const items = this.get_items(params);
        const results: { item: string; possibly_exists: boolean }[] = [];
        for (const item of items) {
          const positions = this.hash_positions(String(item), hash_count, size);
          const exists = positions.every((pos) => this.get_bit(bits, pos));
          results.push({ item: String(item), possibly_exists: exists });
        }
        return JSON.stringify({ results, tested: results.length });
      }
      case "stats": {
        const bits = this.decode_bits(String(params.filter || ""), size);
        let set_bits = 0;
        for (let i = 0; i < size; i++) if (this.get_bit(bits, i)) set_bits++;
        const fill_ratio = set_bits / size;
        const estimated_items = set_bits > 0 ? Math.round(-size / hash_count * Math.log(1 - fill_ratio)) : 0;
        const fp_rate = Math.pow(fill_ratio, hash_count);
        return JSON.stringify({ size, hash_count, set_bits, fill_ratio: Math.round(fill_ratio * 10000) / 10000, estimated_items, false_positive_rate: Math.round(fp_rate * 1e6) / 1e6 });
      }
      case "merge": {
        const bits1 = this.decode_bits(String(params.filter || ""), size);
        const bits2 = this.decode_bits(String(params.filter2 || ""), size);
        const merged = Buffer.alloc(bits1.length);
        for (let i = 0; i < merged.length; i++) merged[i] = bits1[i] | bits2[i];
        return JSON.stringify({ filter: merged.toString("hex"), size });
      }
      case "serialize": {
        const filter = String(params.filter || "");
        return JSON.stringify({ hex: filter, byte_length: filter.length / 2, size, hash_count });
      }
      case "estimate_size": {
        const n = Number(params.expected_items) || 1000;
        const p = Number(params.false_positive_rate) || 0.01;
        const m = Math.ceil(-n * Math.log(p) / (Math.log(2) ** 2));
        const k = Math.ceil((m / n) * Math.log(2));
        return JSON.stringify({ expected_items: n, false_positive_rate: p, recommended_size: m, recommended_hash_count: k, memory_bytes: Math.ceil(m / 8) });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private decode_bits(hex: string, size: number): Buffer {
    if (!hex) return Buffer.alloc(Math.ceil(size / 8));
    return Buffer.from(hex, "hex");
  }

  private get_bit(buf: Buffer, pos: number): boolean {
    return (buf[Math.floor(pos / 8)] & (1 << (pos % 8))) !== 0;
  }

  private set_bit(buf: Buffer, pos: number): void {
    buf[Math.floor(pos / 8)] |= 1 << (pos % 8);
  }

  private hash_positions(item: string, k: number, size: number): number[] {
    const h1 = parseInt(createHash("md5").update(item).digest("hex").slice(0, 8), 16);
    const h2 = parseInt(createHash("md5").update(item + ":salt").digest("hex").slice(0, 8), 16);
    const positions: number[] = [];
    for (let i = 0; i < k; i++) positions.push(Math.abs((h1 + i * h2) % size));
    return positions;
  }

  private get_items(params: Record<string, unknown>): unknown[] {
    if (params.items) {
      try { return JSON.parse(String(params.items)); } catch { return []; }
    }
    if (params.item !== undefined) return [params.item];
    return [];
  }
}
