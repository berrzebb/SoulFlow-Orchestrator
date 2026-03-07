/** sqlite-vec 기반 벡터 스토어 서비스. 네이티브 KNN 검색. */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { create_logger } from "../logger.js";

const log = create_logger("vector-store");

type VecDb = Database.Database;

/** sqlite-vec 확장이 로드된 DB를 열고 콜백 실행 후 닫는다. */
function with_vec_db<T>(db_path: string, run: (db: VecDb) => T): T | null {
  let db: VecDb | null = null;
  try {
    db = new Database(db_path);
    db.pragma("journal_mode=WAL");
    sqliteVec.load(db);
    return run(db);
  } catch (err) {
    log.warn("vec_db_error", { db_path, error: String(err) });
    return null;
  } finally {
    try { db?.close(); } catch { /* no-op */ }
  }
}

function safe_name(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** 벡터 + 문서를 저장하는 sqlite-vec 기반 스토어. */
export function create_vector_store_service(data_dir: string) {
  const store_dir = join(data_dir, "vector-store");
  mkdirSync(store_dir, { recursive: true });

  /** 초기화 완료된 컬렉션 (store_id:collection → dimension). */
  const initialized = new Map<string, number>();

  function db_path(store_id: string): string {
    return join(store_dir, `${safe_name(store_id)}.db`);
  }

  function ensure_meta(db: VecDb, col: string): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "${col}_meta" (
        rid        INTEGER PRIMARY KEY AUTOINCREMENT,
        id         TEXT UNIQUE NOT NULL,
        document   TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  function ensure_vec(db: VecDb, col: string, dim: number): void {
    // L2 distance on normalized vectors → cosine similarity = 1 - (L2² / 2)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS "${col}_vec"
      USING vec0(embedding float[${dim}])
    `);
  }

  function init_collection(db: VecDb, col: string, dim: number): void {
    ensure_meta(db, col);
    ensure_vec(db, col, dim);
  }

  return async (
    op: string,
    opts: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const store_id = String(opts.store_id || "default");
    const collection = String(opts.collection || "default");
    const col = safe_name(collection);
    const path = db_path(store_id);
    const cache_key = `${store_id}:${col}`;

    switch (op) {
      case "upsert": {
        const vectors = opts.vectors as number[][] | undefined;
        const documents = opts.documents as string[] | undefined;
        const ids = opts.ids as string[] | undefined;
        const metadata = opts.metadata as Array<Record<string, unknown>> | undefined;
        if (!vectors?.length) return { error: "vectors required for upsert" };

        const dim = vectors[0].length;
        const count = with_vec_db(path, (db) => {
          init_collection(db, col, dim);
          initialized.set(cache_key, dim);

          const upsert_meta = db.prepare(`
            INSERT INTO "${col}_meta" (id, document, metadata_json)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              document = excluded.document,
              metadata_json = excluded.metadata_json,
              created_at = datetime('now')
          `);
          const get_rid = db.prepare(`SELECT rid FROM "${col}_meta" WHERE id = ?`);
          const delete_vec = db.prepare(`DELETE FROM "${col}_vec" WHERE rowid = ?`);
          const insert_vec = db.prepare(`INSERT INTO "${col}_vec" (rowid, embedding) VALUES (?, ?)`);

          const tx = db.transaction(() => {
            for (let i = 0; i < vectors.length; i++) {
              const id = ids?.[i] ?? crypto.randomUUID();
              const doc = documents?.[i] ?? "";
              const meta = metadata?.[i] ?? {};

              upsert_meta.run(id, doc, JSON.stringify(meta));
              const row = get_rid.get(id) as { rid: number } | undefined;
              if (!row) continue;
              const rid = BigInt(row.rid);

              // vec0는 UPDATE 미지원 → DELETE + INSERT
              delete_vec.run(rid);
              insert_vec.run(rid, normalize(vectors[i]));
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

        const results = with_vec_db(path, (db) => {
          // 메타 테이블이 없으면 빈 결과
          const exists = db.prepare(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
          ).get(`${col}_meta`);
          if (!exists) return [];

          const rows = db.prepare(`
            SELECT m.id, v.distance, m.document, m.metadata_json
            FROM "${col}_vec" v
            JOIN "${col}_meta" m ON m.rid = v.rowid
            WHERE v.embedding MATCH ?
              AND k = ?
            ORDER BY v.distance
          `).all(normalize(query_vector), top_k) as Array<{
            id: string; distance: number; document: string; metadata_json: string;
          }>;

          // 정규화된 벡터의 L2 거리 → 코사인 유사도 변환
          return rows
            .map((r) => ({
              id: r.id,
              score: l2_to_cosine(r.distance),
              document: r.document,
              metadata: JSON.parse(r.metadata_json),
            }))
            .filter((r) => r.score >= min_score);
        }) ?? [];

        log.info("query", { store_id, collection, results: results.length, top_score: results[0]?.score ?? 0 });
        return { results, total_scanned: results.length };
      }

      case "delete": {
        const ids = opts.ids as string[] | undefined;
        if (!ids?.length) return { error: "ids required for delete" };

        const deleted = with_vec_db(path, (db) => {
          const exists = db.prepare(
            `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
          ).get(`${col}_meta`);
          if (!exists) return 0;

          const get_rid = db.prepare(`SELECT rid FROM "${col}_meta" WHERE id = ?`);
          const del_vec = db.prepare(`DELETE FROM "${col}_vec" WHERE rowid = ?`);
          const del_meta = db.prepare(`DELETE FROM "${col}_meta" WHERE id = ?`);

          const tx = db.transaction(() => {
            let count = 0;
            for (const id of ids) {
              const row = get_rid.get(id) as { rid: number } | undefined;
              if (row) {
                del_vec.run(BigInt(row.rid));
                del_meta.run(id);
                count++;
              }
            }
            return count;
          });
          return tx();
        }) ?? 0;

        log.info("delete", { store_id, collection, deleted });
        return { ok: true, deleted };
      }

      default:
        return { error: `unsupported operation: ${op}` };
    }
  };
}

/** L2 단위 벡터로 정규화. */
function normalize(v: number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** 정규화된 벡터의 L2 거리 → 코사인 유사도. */
function l2_to_cosine(l2_dist: number): number {
  return 1 - (l2_dist * l2_dist) / 2;
}
