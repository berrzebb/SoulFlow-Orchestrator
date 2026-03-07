/** VectorStore 도구 — 인메모리 벡터 저장소 (코사인 유사도 검색). */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type VectorEntry = { id: string; vector: number[]; metadata: Record<string, unknown> };
type Collection = { name: string; entries: Map<string, VectorEntry>; dimensions: number };

const MAX_COLLECTIONS = 20;
const MAX_ENTRIES = 10_000;

export class VectorStoreTool extends Tool {
  readonly name = "vector_store";
  readonly category = "ai" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "In-memory vector store with cosine similarity search. Actions: create_collection, insert, query, delete, list_collections, get, count.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create_collection", "insert", "query", "delete", "list_collections", "get", "count"], description: "Operation" },
      collection: { type: "string", description: "Collection name" },
      id: { type: "string", description: "Entry ID (insert/delete/get)" },
      vector: { type: "string", description: "JSON array of numbers (insert/query)" },
      metadata: { type: "string", description: "JSON metadata object (insert)" },
      top_k: { type: "integer", minimum: 1, maximum: 100, description: "Number of results (query, default: 5)" },
      dimensions: { type: "integer", description: "Vector dimensions (create_collection)" },
      filter: { type: "string", description: "JSON metadata filter (query, e.g. {\"type\":\"doc\"})" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly collections = new Map<string, Collection>();

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "");
    switch (action) {
      case "create_collection": return this.create_collection(params);
      case "insert": return this.insert(params);
      case "query": return this.query(params);
      case "delete": return this.del(params);
      case "get": return this.get(params);
      case "count": return this.count(params);
      case "list_collections": return JSON.stringify([...this.collections.values()].map((c) => ({ name: c.name, dimensions: c.dimensions, count: c.entries.size })));
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private create_collection(p: Record<string, unknown>): string {
    const name = String(p.collection || "").trim();
    if (!name) return "Error: collection name required";
    if (this.collections.has(name)) return `Error: collection "${name}" already exists`;
    if (this.collections.size >= MAX_COLLECTIONS) return `Error: max ${MAX_COLLECTIONS} collections`;
    const dims = Number(p.dimensions || 0);
    if (dims < 1) return "Error: dimensions must be >= 1";
    this.collections.set(name, { name, entries: new Map(), dimensions: dims });
    return JSON.stringify({ ok: true, collection: name, dimensions: dims });
  }

  private insert(p: Record<string, unknown>): string {
    const col = this.get_collection(p);
    if (typeof col === "string") return col;
    const id = String(p.id || `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);

    let vector: number[];
    try { vector = JSON.parse(String(p.vector || "[]")); } catch { return "Error: vector must be JSON number array"; }
    if (!Array.isArray(vector) || vector.length !== col.dimensions) {
      return `Error: vector must have ${col.dimensions} dimensions (got ${Array.isArray(vector) ? vector.length : "invalid"})`;
    }

    if (col.entries.size >= MAX_ENTRIES && !col.entries.has(id)) return `Error: max ${MAX_ENTRIES} entries`;

    let metadata: Record<string, unknown> = {};
    if (p.metadata) { try { metadata = JSON.parse(String(p.metadata)); } catch { return "Error: invalid metadata JSON"; } }

    col.entries.set(id, { id, vector, metadata });
    return JSON.stringify({ ok: true, id, collection: col.name });
  }

  private query(p: Record<string, unknown>): string {
    const col = this.get_collection(p);
    if (typeof col === "string") return col;

    let query_vec: number[];
    try { query_vec = JSON.parse(String(p.vector || "[]")); } catch { return "Error: vector must be JSON number array"; }
    if (query_vec.length !== col.dimensions) return `Error: query vector must have ${col.dimensions} dimensions`;

    const top_k = Math.min(100, Math.max(1, Number(p.top_k || 5)));
    let filter: Record<string, unknown> | null = null;
    if (p.filter) { try { filter = JSON.parse(String(p.filter)); } catch { return "Error: invalid filter JSON"; } }

    const scored: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];
    for (const entry of col.entries.values()) {
      if (filter && !this.matches_filter(entry.metadata, filter)) continue;
      const score = this.cosine(query_vec, entry.vector);
      scored.push({ id: entry.id, score, metadata: entry.metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return JSON.stringify({ results: scored.slice(0, top_k), total_searched: col.entries.size });
  }

  private del(p: Record<string, unknown>): string {
    const col = this.get_collection(p);
    if (typeof col === "string") return col;
    const id = String(p.id || "");
    if (!id) return "Error: id required";
    return col.entries.delete(id) ? JSON.stringify({ ok: true, deleted: id }) : `Error: entry "${id}" not found`;
  }

  private get(p: Record<string, unknown>): string {
    const col = this.get_collection(p);
    if (typeof col === "string") return col;
    const id = String(p.id || "");
    const entry = col.entries.get(id);
    if (!entry) return `Error: entry "${id}" not found`;
    return JSON.stringify(entry);
  }

  private count(p: Record<string, unknown>): string {
    const col = this.get_collection(p);
    if (typeof col === "string") return col;
    return JSON.stringify({ collection: col.name, count: col.entries.size });
  }

  private get_collection(p: Record<string, unknown>): Collection | string {
    const name = String(p.collection || "").trim();
    if (!name) return "Error: collection name required";
    const col = this.collections.get(name);
    if (!col) return `Error: collection "${name}" not found`;
    return col;
  }

  private matches_filter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      if (metadata[key] !== expected) return false;
    }
    return true;
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0, ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      ma += a[i]! * a[i]!;
      mb += b[i]! * b[i]!;
    }
    const d = Math.sqrt(ma) * Math.sqrt(mb);
    return d === 0 ? 0 : dot / d;
  }
}
