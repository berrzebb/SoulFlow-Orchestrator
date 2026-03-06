/** SQLite 기반 벡터 스토어 서비스. 코사인 유사도 검색 지원. */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { with_sqlite } from "../utils/sqlite-helper.js";
import { create_logger } from "../logger.js";

const log = create_logger("vector-store");

/** 벡터 + 문서를 저장하는 SQLite 기반 스토어. */
export function create_vector_store_service(data_dir: string) {
  const store_dir = join(data_dir, "vector-store");
  mkdirSync(store_dir, { recursive: true });

  function db_path(store_id: string): string {
    const safe = store_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(store_dir, `${safe}.db`);
  }

  function ensure_table(store_id: string, collection: string): void {
    const safe_col = collection.replace(/[^a-zA-Z0-9_]/g, "_");
    with_sqlite(db_path(store_id), (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${safe_col}" (
          id TEXT PRIMARY KEY,
          vector_json TEXT NOT NULL,
          document TEXT NOT NULL DEFAULT '',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    });
  }

  return async (
    op: string,
    opts: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const store_id = String(opts.store_id || "default");
    const collection = String(opts.collection || "default");
    ensure_table(store_id, collection);
    const safe_col = collection.replace(/[^a-zA-Z0-9_]/g, "_");
    const path = db_path(store_id);

    switch (op) {
      case "upsert": {
        const vectors = opts.vectors as number[][] | undefined;
        const documents = opts.documents as string[] | undefined;
        const ids = opts.ids as string[] | undefined;
        const metadata = opts.metadata as Array<Record<string, unknown>> | undefined;
        if (!vectors?.length) return { error: "vectors required for upsert" };

        const count = with_sqlite(path, (db) => {
          const stmt = db.prepare(`
            INSERT INTO "${safe_col}" (id, vector_json, document, metadata_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              vector_json = excluded.vector_json,
              document = excluded.document,
              metadata_json = excluded.metadata_json,
              created_at = datetime('now')
          `);
          const tx = db.transaction(() => {
            for (let i = 0; i < vectors.length; i++) {
              const id = ids?.[i] ?? crypto.randomUUID();
              const doc = documents?.[i] ?? "";
              const meta = metadata?.[i] ?? {};
              stmt.run(id, JSON.stringify(vectors[i]), doc, JSON.stringify(meta));
            }
            return vectors.length;
          });
          return tx();
        }) ?? 0;

        log.info("upsert", { store_id, collection, count });
        return { ok: true, upserted: count };
      }

      case "query": {
        const query_vector = opts.query_vector as number[] | undefined;
        if (!query_vector?.length) return { error: "query_vector required" };
        const top_k = Number(opts.top_k) || 10;
        const min_score = Number(opts.min_score) || 0;

        const rows = with_sqlite(path, (db) => {
          return db.prepare(`SELECT id, vector_json, document, metadata_json FROM "${safe_col}"`).all() as Array<{
            id: string; vector_json: string; document: string; metadata_json: string;
          }>;
        }) ?? [];

        // 코사인 유사도 계산 + 정렬
        const scored = rows.map((row) => {
          const vec = JSON.parse(row.vector_json) as number[];
          const score = cosine_similarity(query_vector, vec);
          return {
            id: row.id,
            score,
            document: row.document,
            metadata: JSON.parse(row.metadata_json),
          };
        }).filter((r) => r.score >= min_score);

        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, top_k);

        log.info("query", { store_id, collection, results: results.length, top_score: results[0]?.score ?? 0 });
        return { results, total_scanned: rows.length };
      }

      case "delete": {
        const ids = opts.ids as string[] | undefined;
        if (!ids?.length) return { error: "ids required for delete" };

        const deleted = with_sqlite(path, (db) => {
          const placeholders = ids.map(() => "?").join(",");
          const result = db.prepare(`DELETE FROM "${safe_col}" WHERE id IN (${placeholders})`).run(...ids);
          return result.changes;
        }) ?? 0;

        log.info("delete", { store_id, collection, deleted });
        return { ok: true, deleted };
      }

      default:
        return { error: `unsupported operation: ${op}` };
    }
  };
}

/** 코사인 유사도: dot(a,b) / (|a| * |b|). */
function cosine_similarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, norm_a = 0, norm_b = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    norm_a += a[i] * a[i];
    norm_b += b[i] * b[i];
  }
  const denom = Math.sqrt(norm_a) * Math.sqrt(norm_b);
  return denom > 0 ? dot / denom : 0;
}
