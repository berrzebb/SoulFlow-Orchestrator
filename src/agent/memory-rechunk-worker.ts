/** 메모리 청킹 + 임베딩 워커 — 메인 스레드 블로킹 없이 SQLite 청크 인덱스 및 벡터 갱신. */

import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import { error_message } from "../utils/common.js";
import { HTTP_FETCH_TIMEOUT_MS } from "../utils/timeouts.js";
import * as sqliteVec from "sqlite-vec";
import { chunk_markdown } from "./memory-chunker.js";
import type { EmbedWorkerConfig } from "./memory.types.js";
import { normalize_vec_f32 } from "../utils/vec.js";

export type RechunkJob = {
  sqlite_path: string;
  doc_key: string;
  kind: string;
  day: string;
  content: string;
  embed?: EmbedWorkerConfig;
};

const MAX_EMBED_CHARS = 2000;
const MAX_BATCH_SIZE = 96;

parentPort!.on("message", async (job: RechunkJob) => {
  const { sqlite_path, doc_key, kind, day, content, embed } = job;
  let db: Database.Database | null = null;
  try {
    const new_chunks = chunk_markdown(content, doc_key);
    const new_ids = new Set(new_chunks.map((c) => c.chunk_id));

    db = new Database(sqlite_path);
    sqliteVec.load(db);

    const existing = db
      .prepare("SELECT chunk_id, content_hash FROM memory_chunks WHERE doc_key = ?")
      .all(doc_key) as { chunk_id: string; content_hash: string }[];

    const existing_map = new Map(existing.map((r) => [r.chunk_id, r.content_hash]));
    const to_delete = existing.filter((r) => !new_ids.has(r.chunk_id)).map((r) => r.chunk_id);

    if (to_delete.length > 0) {
      // 벡터 삭제: memory_chunks_vec는 CASCADE 없음 → rowid 수집 후 먼저 삭제
      const placeholders = to_delete.map(() => "?").join(",");
      const del_rowids = db
        .prepare(`SELECT rowid FROM memory_chunks WHERE chunk_id IN (${placeholders})`)
        .all(...to_delete) as { rowid: number }[];
      if (del_rowids.length > 0) {
        try {
          const vec_ph = del_rowids.map(() => "?").join(",");
          db.prepare(`DELETE FROM memory_chunks_vec WHERE rowid IN (${vec_ph})`)
            .run(...del_rowids.map((r) => r.rowid));
        } catch { /* vec table may not exist */ }
      }
      const del_stmt = db.prepare("DELETE FROM memory_chunks WHERE chunk_id = ?");
      for (const id of to_delete) del_stmt.run(id);
    }

    const upsert = db.prepare(`
      INSERT INTO memory_chunks (chunk_id, doc_key, kind, day, heading, start_line, end_line, content, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        content = excluded.content,
        content_hash = excluded.content_hash
    `);

    // 변경된 청크만 upsert, 변경 여부 추적
    const upserted_chunk_ids = new Set<string>();
    for (const c of new_chunks) {
      if (existing_map.get(c.chunk_id) === c.content_hash) continue;
      upsert.run(c.chunk_id, doc_key, kind, day, c.heading, c.start_line, c.end_line, c.content, c.content_hash);
      upserted_chunk_ids.add(c.chunk_id);
    }

    db.close();
    db = null;

    // 임베딩 설정이 있고 새로 upsert된 청크가 있으면 벡터 생성
    if (embed && upserted_chunk_ids.size > 0) {
      await embed_new_chunks(sqlite_path, upserted_chunk_ids, embed);
    }
  } catch (err) {
    const msg = error_message(err);
    process.stderr.write(`[rechunk-worker] job failed for ${doc_key}: ${msg}\n`);
  } finally {
    try { db?.close(); } catch { /* no-op */ }
  }
});

/** 새로 upsert된 청크의 rowid를 조회하여 임베딩 후 벡터 저장. */
async function embed_new_chunks(
  sqlite_path: string,
  chunk_ids: Set<string>,
  cfg: EmbedWorkerConfig,
): Promise<void> {
  let db: Database.Database | null = null;
  try {
    db = new Database(sqlite_path);
    const placeholders = Array.from(chunk_ids).map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT rowid, chunk_id, content FROM memory_chunks WHERE chunk_id IN (${placeholders})`,
    ).all(...Array.from(chunk_ids)) as { rowid: number; chunk_id: string; content: string }[];

    if (rows.length === 0) return;

    const texts = rows.map((r) => r.content.slice(0, MAX_EMBED_CHARS));
    const embeddings = await fetch_embeddings(texts, cfg);
    if (!embeddings || embeddings.length !== rows.length) return;

    sqliteVec.load(db);
    db.pragma("journal_mode=WAL");

    const ins_vec = db.prepare("INSERT OR REPLACE INTO memory_chunks_vec (rowid, embedding) VALUES (?, ?)");
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        ins_vec.run(BigInt(rows[i].rowid), normalize_vec_f32(embeddings[i]));
      }
    });
    tx();
  } finally {
    try { db?.close(); } catch { /* no-op */ }
  }
}

/** OpenAI 호환 /embeddings 엔드포인트 호출. */
async function fetch_embeddings(texts: string[], cfg: EmbedWorkerConfig): Promise<number[][] | null> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const body: Record<string, unknown> = { model: cfg.model, input: batch };
    if (cfg.dims) body.dimensions = cfg.dims;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;

    const res = await fetch(`${cfg.api_base}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const json = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) all.push(item.embedding);
  }
  return all;
}

