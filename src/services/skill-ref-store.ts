/**
 * SkillRefStore — skills/{name}/references/ 파일을 RAG 인덱싱.
 * ReferenceStoreLike 인터페이스를 구현하여 context.service.ts에서 동일하게 사용.
 *
 * 스캔 경로: skills_roots 하위 모든 references 디렉터리의 .md 파일.
 * SKILL.md 자체는 제외 — 본문은 load_skills_for_context()가 처리.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { EmbedFn } from "../agent/memory.service.js";
import type { ReferenceStoreLike, ReferenceSearchResult } from "./reference-store.js";

const VEC_DIMENSIONS = 256;
const MAX_EMBED_CHARS = 1500;
const CHUNK_SIZE = 1200;
const SYNC_DEBOUNCE_MS = 5 * 60_000; // 스킬 파일은 자주 바뀌지 않으므로 5분

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS skill_ref_documents (
    path         TEXT PRIMARY KEY,
    skill_name   TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    chunk_count  INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_ref_chunks (
    chunk_id  TEXT PRIMARY KEY,
    doc_path  TEXT NOT NULL REFERENCES skill_ref_documents(path) ON DELETE CASCADE,
    skill_name TEXT NOT NULL DEFAULT '',
    heading   TEXT NOT NULL DEFAULT '',
    content   TEXT NOT NULL,
    start_line INTEGER NOT NULL DEFAULT 0,
    end_line   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_src_doc ON skill_ref_chunks(doc_path);
  CREATE INDEX IF NOT EXISTS idx_src_skill ON skill_ref_chunks(skill_name);
  CREATE TABLE IF NOT EXISTS skill_ref_chunk_docs (
    rowid     INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id  TEXT NOT NULL,
    content   TEXT NOT NULL DEFAULT ''
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS skill_ref_chunks_fts USING fts5(
    chunk_id, content,
    content='skill_ref_chunk_docs',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
`;

export class SkillRefStore implements ReferenceStoreLike {
  private readonly db_path: string;
  private embed_fn: EmbedFn | null = null;
  private last_sync = 0;
  private initialized = false;

  constructor(
    /** src/skills 등 스킬 루트 디렉터리 목록. */
    private readonly skills_roots: string[],
    /** runtime DB 저장 디렉터리. */
    data_dir: string,
  ) {
    mkdirSync(data_dir, { recursive: true });
    this.db_path = join(data_dir, "skill-refs.db");
  }

  set_embed(fn: EmbedFn): void { this.embed_fn = fn; }

  private ensure_init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const db = new Database(this.db_path);
    try {
      db.pragma("journal_mode=WAL");
      db.pragma("foreign_keys=ON");
      db.exec(INIT_SQL);
      sqliteVec.load(db);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS skill_ref_chunks_vec USING vec0(embedding float[${VEC_DIMENSIONS}])`);
    } finally {
      db.close();
    }
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    const now = Date.now();
    if (now - this.last_sync < SYNC_DEBOUNCE_MS) return { added: 0, updated: 0, removed: 0 };
    this.last_sync = now;
    this.ensure_init();

    const fs_files = this.scan_skill_refs();
    const fs_paths = new Set(fs_files.map((f) => f.rel_path));

    const db = new Database(this.db_path);
    let added = 0, updated = 0, removed = 0;
    try {
      sqliteVec.load(db);

      const db_docs = db.prepare("SELECT path, content_hash FROM skill_ref_documents").all() as { path: string; content_hash: string }[];
      const db_map = new Map(db_docs.map((d) => [d.path, d.content_hash]));

      for (const [db_path] of db_map) {
        if (!fs_paths.has(db_path)) {
          this.remove_document(db, db_path);
          removed++;
        }
      }

      const to_embed: { chunk_id: string; text: string }[] = [];

      for (const file of fs_files) {
        const content = readFileSync(file.abs_path, "utf-8");
        const hash = sha256_short(content);

        if (db_map.get(file.rel_path) === hash) continue;

        const is_new = !db_map.has(file.rel_path);
        if (!is_new) this.remove_document(db, file.rel_path);

        const chunks = this.chunk_markdown(content, file.rel_path, file.skill_name);
        const ts = new Date().toISOString();

        db.prepare("INSERT OR REPLACE INTO skill_ref_documents (path, skill_name, content_hash, chunk_count, updated_at) VALUES (?, ?, ?, ?, ?)").run(file.rel_path, file.skill_name, hash, chunks.length, ts);

        const ins_chunk = db.prepare("INSERT INTO skill_ref_chunks (chunk_id, doc_path, skill_name, heading, content, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const ins_fts_content = db.prepare("INSERT INTO skill_ref_chunk_docs (chunk_id, content) VALUES (?, ?)");
        const ins_fts = db.prepare("INSERT INTO skill_ref_chunks_fts (rowid, chunk_id, content) VALUES (?, ?, ?)");

        for (const chunk of chunks) {
          ins_chunk.run(chunk.chunk_id, file.rel_path, file.skill_name, chunk.heading, chunk.content, chunk.start_line, chunk.end_line);
          const info = ins_fts_content.run(chunk.chunk_id, chunk.content);
          ins_fts.run(info.lastInsertRowid, chunk.chunk_id, chunk.content);
          to_embed.push({
            chunk_id: chunk.chunk_id,
            text: `[${file.skill_name}/${basename(file.rel_path)}] ${chunk.heading}\n${chunk.content}`.slice(0, MAX_EMBED_CHARS),
          });
        }

        if (is_new) added++;
        else updated++;
      }

      if (this.embed_fn && to_embed.length > 0) {
        await this.embed_chunks(db, to_embed);
      }
    } finally {
      db.close();
    }

    return { added, updated, removed };
  }

  async search(query: string, opts?: { limit?: number; doc_filter?: string }): Promise<ReferenceSearchResult[]> {
    this.ensure_init();
    const limit = opts?.limit ?? 5;
    const results = new Map<string, ReferenceSearchResult>();
    const skill_filter = opts?.doc_filter;

    const db = new Database(this.db_path, { readonly: true });
    try {
      sqliteVec.load(db);

      // FTS5
      const terms = query.toLowerCase().replace(/[^a-z0-9가-힣_\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
      if (terms.length > 0) {
        const fts_query = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
        try {
          let sql = `
            SELECT c.chunk_id, c.doc_path, c.skill_name, c.heading, c.content, bm25(skill_ref_chunks_fts, 1.0, 2.0) AS score
            FROM skill_ref_chunks_fts f
            JOIN skill_ref_chunk_docs d ON d.rowid = f.rowid
            JOIN skill_ref_chunks c ON c.chunk_id = d.chunk_id
            WHERE skill_ref_chunks_fts MATCH ?`;
          const params: unknown[] = [fts_query];
          if (skill_filter) { sql += " AND c.skill_name IN (SELECT value FROM json_each(?))"; params.push(JSON.stringify(skill_filter.split("|"))); }
          sql += " ORDER BY score LIMIT ?";
          params.push(limit * 2);

          const rows = db.prepare(sql).all(...params) as Array<{ chunk_id: string; doc_path: string; skill_name: string; heading: string; content: string; score: number }>;
          for (const r of rows) {
            results.set(r.chunk_id, { chunk_id: r.chunk_id, doc_path: r.doc_path, heading: r.heading, content: r.content, score: Math.abs(r.score) });
          }
        } catch { /* FTS 실패 시 벡터만 사용 */ }
      }

      // 벡터 KNN
      if (this.embed_fn) {
        try {
          const { embeddings } = await this.embed_fn([query.slice(0, MAX_EMBED_CHARS)], { dimensions: VEC_DIMENSIONS });
          if (embeddings.length > 0) {
            const qvec = normalize_vec(embeddings[0]!);
            const qbuf = new Float32Array(qvec);

            let vec_sql = `SELECT v.rowid, v.distance FROM skill_ref_chunks_vec v WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance`;
            const vec_rows = db.prepare(vec_sql).all(qbuf, limit * 2) as { rowid: number; distance: number }[];

            if (vec_rows.length > 0) {
              const rowids = vec_rows.map((r) => r.rowid);
              const doc_rows = db.prepare(`SELECT d.rowid, d.chunk_id FROM skill_ref_chunk_docs d WHERE d.rowid IN (${rowids.map(() => "?").join(",")})`).all(...rowids) as { rowid: number; chunk_id: string }[];
              const rowid_to_chunk = new Map(doc_rows.map((r) => [r.rowid, r.chunk_id]));

              for (const vr of vec_rows) {
                const chunk_id = rowid_to_chunk.get(vr.rowid);
                if (!chunk_id || results.has(chunk_id)) continue;
                const chunk = db.prepare("SELECT chunk_id, doc_path, heading, content FROM skill_ref_chunks WHERE chunk_id = ?").get(chunk_id) as { chunk_id: string; doc_path: string; heading: string; content: string } | undefined;
                if (chunk) {
                  if (skill_filter) {
                    const skill = db.prepare("SELECT skill_name FROM skill_ref_chunks WHERE chunk_id = ?").get(chunk_id) as { skill_name: string } | undefined;
                    if (skill && !skill_filter.split("|").includes(skill.skill_name)) continue;
                  }
                  results.set(chunk_id, { ...chunk, score: 1 / (1 + vr.distance) });
                }
              }
            }
          }
        } catch { /* 벡터 실패 시 FTS만 사용 */ }
      }
    } finally {
      db.close();
    }

    return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  list_documents(): { path: string; chunks: number; size: number; updated_at: string }[] {
    this.ensure_init();
    const db = new Database(this.db_path, { readonly: true });
    try {
      return db.prepare("SELECT path, chunk_count as chunks, 0 as size, updated_at FROM skill_ref_documents ORDER BY path").all() as Array<{ path: string; chunks: number; size: number; updated_at: string }>;
    } finally {
      db.close();
    }
  }

  get_stats(): { total_docs: number; total_chunks: number; last_sync: string | null } {
    this.ensure_init();
    const db = new Database(this.db_path, { readonly: true });
    try {
      const docs = (db.prepare("SELECT COUNT(*) as c FROM skill_ref_documents").get() as { c: number } | undefined)?.c ?? 0;
      const chunks = (db.prepare("SELECT COUNT(*) as c FROM skill_ref_chunks").get() as { c: number } | undefined)?.c ?? 0;
      return { total_docs: docs, total_chunks: chunks, last_sync: this.last_sync ? new Date(this.last_sync).toISOString() : null };
    } finally {
      db.close();
    }
  }

  // ── Private ──

  /** 스킬 루트 하위 references/ 디렉터리의 모든 .md 파일 스캔. */
  private scan_skill_refs(): { rel_path: string; abs_path: string; skill_name: string }[] {
    const result: { rel_path: string; abs_path: string; skill_name: string }[] = [];
    for (const root of this.skills_roots) {
      if (!existsSync(root)) continue;
      try {
        for (const skill_dir of readdirSync(root, { withFileTypes: true })) {
          if (!skill_dir.isDirectory() || skill_dir.name.startsWith("_") || skill_dir.name.startsWith(".")) continue;
          const refs_dir = join(root, skill_dir.name, "references");
          if (!existsSync(refs_dir)) continue;
          this.collect_md_files(refs_dir, skill_dir.name, result);
        }
      } catch { /* 읽기 실패 시 무시 */ }
    }
    return result;
  }

  private collect_md_files(
    dir: string,
    skill_name: string,
    out: { rel_path: string; abs_path: string; skill_name: string }[],
  ): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.collect_md_files(abs, skill_name, out);
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
          // rel_path: "skill_name/references/filename.md" 형식
          const rel = `${skill_name}/references/${entry.name}`;
          out.push({ rel_path: rel, abs_path: abs, skill_name });
        }
      }
    } catch { /* 읽기 실패 시 무시 */ }
  }

  private chunk_markdown(content: string, source_path: string, skill_name: string): Array<{ chunk_id: string; doc_path: string; heading: string; content: string; start_line: number; end_line: number }> {
    const lines = content.split(/\r?\n/);
    const chunks: Array<{ chunk_id: string; doc_path: string; heading: string; content: string; start_line: number; end_line: number }> = [];
    let heading = "";
    let buf: string[] = [];
    let start = 1;

    const flush = () => {
      const text = buf.join("\n").trim();
      if (!text) return;
      chunks.push({
        chunk_id: sha256_short(`${skill_name}:${source_path}:${start}`),
        doc_path: source_path,
        heading,
        content: text,
        start_line: start,
        end_line: start + buf.length - 1,
      });
    };

    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
      if (m) {
        flush();
        heading = m[2]!.trim();
        buf = [lines[i]!];
        start = i + 1;
        continue;
      }
      buf.push(lines[i]!);
      if (buf.join("\n").length > CHUNK_SIZE) {
        const prev_start = start;
        flush();
        const overlap = buf.slice(-3);
        const next_start = i - overlap.length + 2;
        if (next_start > prev_start) { buf = [...overlap]; start = next_start; }
        else { buf = []; start = i + 2; }
      }
    }
    flush();
    return chunks;
  }

  private remove_document(db: Database.Database, path: string): void {
    const rows = db.prepare("SELECT rowid FROM skill_ref_chunk_docs WHERE chunk_id IN (SELECT chunk_id FROM skill_ref_chunks WHERE doc_path = ?)").all(path) as { rowid: number }[];
    if (rows.length > 0) {
      const placeholders = rows.map(() => "?").join(",");
      const rowids = rows.map((r) => r.rowid);
      try { db.prepare(`DELETE FROM skill_ref_chunks_vec WHERE rowid IN (${placeholders})`).run(...rowids); } catch { /* vec table may not exist */ }
      db.prepare(`DELETE FROM skill_ref_chunks_fts WHERE rowid IN (${placeholders})`).run(...rowids);
      db.prepare(`DELETE FROM skill_ref_chunk_docs WHERE rowid IN (${placeholders})`).run(...rowids);
    }
    db.prepare("DELETE FROM skill_ref_chunks WHERE doc_path = ?").run(path);
    db.prepare("DELETE FROM skill_ref_documents WHERE path = ?").run(path);
  }

  private async embed_chunks(db: Database.Database, items: { chunk_id: string; text: string }[]): Promise<void> {
    if (!this.embed_fn || items.length === 0) return;
    const BATCH_SIZE = 96;
    const del_vec = db.prepare("DELETE FROM skill_ref_chunks_vec WHERE rowid = ?");
    const ins_vec = db.prepare("INSERT INTO skill_ref_chunks_vec (rowid, embedding) VALUES (?, ?)");

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      try {
        const { embeddings } = await this.embed_fn(batch.map((b) => b.text), { dimensions: VEC_DIMENSIONS });
        const chunk_ids = batch.map((b) => b.chunk_id);
        const rows = db.prepare(`SELECT rowid, chunk_id FROM skill_ref_chunk_docs WHERE chunk_id IN (${chunk_ids.map(() => "?").join(",")})`).all(...chunk_ids) as { rowid: number; chunk_id: string }[];
        const id_to_rowid = new Map(rows.map((r) => [r.chunk_id, r.rowid]));
        const tx = db.transaction(() => {
          for (let j = 0; j < batch.length; j++) {
            const rowid = id_to_rowid.get(batch[j]!.chunk_id);
            if (rowid === undefined) continue;
            const vec = normalize_vec(embeddings[j]!);
            try { del_vec.run(rowid); } catch { /* 없을 수 있음 */ }
            ins_vec.run(rowid, new Float32Array(vec));
          }
        });
        tx();
      } catch { /* 임베딩 실패 시 FTS만 사용 */ }
    }
  }
}

function sha256_short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalize_vec(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
