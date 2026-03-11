/**
 * Reference Store — workspace/references/ 문서를 청킹 + 임베딩하여 벡터 DB에 저장.
 * 채팅 시 사용자 메시지와 관련된 문서 청크를 자동 검색하여 컨텍스트에 주입.
 *
 * 동기화: sync() 호출 시 파일 시스템 스캔 → content_hash 비교 → 변경분만 재처리.
 * debounce: 60초 이내 재호출 스킵.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { EmbedFn } from "../agent/memory.service.js";
import type { ImageEmbedFn } from "./embed.service.js";
import { extract_doc_text, BINARY_DOC_EXTENSIONS } from "../utils/doc-extractor.js";
import { now_iso } from "../utils/common.js";

const VEC_DIMENSIONS = 256;
const MAX_EMBED_CHARS = 1500;
const CHUNK_SIZE = 1200;
const SYNC_DEBOUNCE_MS = 60_000;
const MAX_SEARCH_RESULTS = 8;

/** 텍스트 파일 확장자. */
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".xml", ".html", ".log", ".ts", ".js", ".py", ".sh", ".sql", ".toml", ".ini", ".cfg", ".env.example"]);
/** 이미지 파일 확장자 (멀티모달 임베딩 모델 필요). */
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
/** 전체 지원 확장자 (텍스트 + 바이너리 문서 + 이미지). */
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_DOC_EXTENSIONS, ...SUPPORTED_IMAGE_EXTENSIONS]);

export interface ReferenceChunk {
  chunk_id: string;
  doc_path: string;
  heading: string;
  content: string;
  start_line: number;
  end_line: number;
}

export interface ReferenceSearchResult {
  chunk_id: string;
  doc_path: string;
  heading: string;
  content: string;
  score: number;
}

export interface ReferenceStoreLike {
  set_embed(fn: EmbedFn): void;
  sync(opts?: { force?: boolean }): Promise<{ added: number; updated: number; removed: number }>;
  search(query: string, opts?: { limit?: number; doc_filter?: string }): Promise<ReferenceSearchResult[]>;
  list_documents(): { path: string; chunks: number; size: number; updated_at: string }[];
  get_stats(): { total_docs: number; total_chunks: number; last_sync: string | null };
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS ref_documents (
    path         TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    chunk_count  INTEGER NOT NULL DEFAULT 0,
    file_size    INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL,
    media_type   TEXT NOT NULL DEFAULT 'text'
  );
  CREATE TABLE IF NOT EXISTS ref_media (
    chunk_id   TEXT PRIMARY KEY REFERENCES ref_chunks(chunk_id) ON DELETE CASCADE,
    file_path  TEXT NOT NULL,
    media_type TEXT NOT NULL,
    alt_text   TEXT
  );
  CREATE TABLE IF NOT EXISTS ref_chunks (
    chunk_id    TEXT PRIMARY KEY,
    doc_path    TEXT NOT NULL REFERENCES ref_documents(path) ON DELETE CASCADE,
    heading     TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    start_line  INTEGER NOT NULL DEFAULT 0,
    end_line    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_ref_chunks_doc ON ref_chunks(doc_path);
  CREATE TABLE IF NOT EXISTS ref_chunk_docs (
    rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id    TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT ''
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS ref_chunks_fts USING fts5(
    chunk_id, content,
    content='ref_chunk_docs',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
`;

export class ReferenceStore implements ReferenceStoreLike {
  private readonly db_path: string;
  private readonly refs_dir: string;
  private embed_fn: EmbedFn | null = null;
  private image_embed_fn: ImageEmbedFn | null = null;
  private last_sync = 0;
  private initialized = false;

  constructor(private readonly workspace: string) {
    this.refs_dir = join(workspace, "references");
    const db_dir = join(workspace, "runtime", "references");
    mkdirSync(db_dir, { recursive: true });
    this.db_path = join(db_dir, "references.db");
  }

  set_embed(fn: EmbedFn): void { this.embed_fn = fn; }

  /** 이미지 파일 임베딩용 멀티모달 함수 주입. 미설정 시 이미지는 FTS 없이 경로만 저장. */
  set_image_embed(fn: ImageEmbedFn): void { this.image_embed_fn = fn; }

  private ensure_init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const db = new Database(this.db_path);
    try {
      db.pragma("journal_mode=WAL");
      db.pragma("foreign_keys=ON");
      db.exec(INIT_SQL);
      sqliteVec.load(db);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ref_chunks_vec USING vec0(embedding float[${VEC_DIMENSIONS}])`);
    } finally {
      db.close();
    }
  }

  async sync(opts?: { force?: boolean }): Promise<{ added: number; updated: number; removed: number }> {
    const now = Date.now();
    if (!opts?.force && now - this.last_sync < SYNC_DEBOUNCE_MS) return { added: 0, updated: 0, removed: 0 };
    this.last_sync = now;
    this.ensure_init();

    if (!existsSync(this.refs_dir)) {
      mkdirSync(this.refs_dir, { recursive: true });
      return { added: 0, updated: 0, removed: 0 };
    }

    // 파일 시스템 스캔
    const fs_files = this.scan_files(this.refs_dir);
    const fs_paths = new Set(fs_files.map((f) => f.rel_path));

    const db = new Database(this.db_path);
    let added = 0, updated = 0, removed = 0;
    try {
      sqliteVec.load(db);

      // DB에 있는 문서 목록
      const db_docs = db.prepare("SELECT path, content_hash FROM ref_documents").all() as { path: string; content_hash: string }[];
      const db_map = new Map(db_docs.map((d) => [d.path, d.content_hash]));

      // 삭제된 파일 제거
      for (const [db_path] of db_map) {
        if (!fs_paths.has(db_path)) {
          this.remove_document(db, db_path);
          removed++;
        }
      }

      // 추가/변경된 파일 처리
      const to_embed: { chunk_id: string; text: string }[] = [];
      const to_image_embed: { chunk_id: string; data_url: string }[] = [];

      const ins_chunk = db.prepare("INSERT INTO ref_chunks (chunk_id, doc_path, heading, content, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)");
      const ins_fts_content = db.prepare("INSERT INTO ref_chunk_docs (chunk_id, content) VALUES (?, ?)");
      const ins_fts = db.prepare("INSERT INTO ref_chunks_fts (rowid, chunk_id, content) VALUES (?, ?, ?)");
      const ins_media = db.prepare("INSERT INTO ref_media (chunk_id, file_path, media_type, alt_text) VALUES (?, ?, ?, ?)");

      for (const file of fs_files) {
        const ext = extname(file.abs_path).toLowerCase();
        const is_binary = BINARY_DOC_EXTENSIONS.has(ext);
        const is_image = SUPPORTED_IMAGE_EXTENSIONS.has(ext);

        const raw_buf = await readFile(file.abs_path);
        const hash = sha256_short(raw_buf.toString("binary"));

        if (db_map.get(file.rel_path) === hash) continue;

        const is_new = !db_map.has(file.rel_path);
        if (!is_new) this.remove_document(db, file.rel_path);

        const file_size = statSync(file.abs_path).size;
        const ts = now_iso();

        if (is_image) {
          // 이미지: 단일 청크 (FTS 없음, 경로 + alt_text만 저장)
          const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
            : ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp" : "image/jpeg";
          const chunk_id = sha256_short(`${file.rel_path}:image`);
          const display = `[이미지: ${file.rel_path}]`;

          db.prepare("INSERT OR REPLACE INTO ref_documents (path, content_hash, chunk_count, file_size, updated_at, media_type) VALUES (?, ?, ?, ?, ?, ?)").run(file.rel_path, hash, 1, file_size, ts, "image");
          ins_chunk.run(chunk_id, file.rel_path, "", display, 0, 0);
          ins_media.run(chunk_id, file.rel_path, "image", null);

          if (this.image_embed_fn) {
            const data_url = `data:${mime};base64,${raw_buf.toString("base64")}`;
            to_image_embed.push({ chunk_id, data_url });
          }
        } else {
          // 텍스트/바이너리 문서
          const text_content = is_binary
            ? await extract_doc_text(raw_buf, ext)
            : raw_buf.toString("utf-8");

          const chunks = this.chunk_text(text_content, file.rel_path);

          db.prepare("INSERT OR REPLACE INTO ref_documents (path, content_hash, chunk_count, file_size, updated_at, media_type) VALUES (?, ?, ?, ?, ?, ?)").run(file.rel_path, hash, chunks.length, file_size, ts, "text");

          for (const chunk of chunks) {
            ins_chunk.run(chunk.chunk_id, file.rel_path, chunk.heading, chunk.content, chunk.start_line, chunk.end_line);
            const info = ins_fts_content.run(chunk.chunk_id, chunk.content);
            ins_fts.run(info.lastInsertRowid, chunk.chunk_id, chunk.content);
            to_embed.push({ chunk_id: chunk.chunk_id, text: `[${file.rel_path}] ${chunk.heading}\n${chunk.content}`.slice(0, MAX_EMBED_CHARS) });
          }
        }

        if (is_new) added++;
        else updated++;
      }

      // 텍스트 벡터 임베딩
      if (this.embed_fn && to_embed.length > 0) {
        await this.embed_chunks(db, to_embed);
      }
      // 이미지 벡터 임베딩
      if (this.image_embed_fn && to_image_embed.length > 0) {
        await this.embed_image_chunks(db, to_image_embed);
      }
    } finally {
      db.close();
    }

    return { added, updated, removed };
  }

  async search(query: string, opts?: { limit?: number; doc_filter?: string }): Promise<ReferenceSearchResult[]> {
    this.ensure_init();
    const limit = opts?.limit ?? MAX_SEARCH_RESULTS;
    const results = new Map<string, ReferenceSearchResult>();

    const db = new Database(this.db_path, { readonly: true });
    try {
      sqliteVec.load(db);

      // FTS5 키워드 검색
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9가-힣_\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2);

      if (terms.length > 0) {
        const fts_query = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
        try {
          let sql = `
            SELECT c.chunk_id, c.doc_path, c.heading, c.content, bm25(ref_chunks_fts, 1.0, 2.0) AS score
            FROM ref_chunks_fts f
            JOIN ref_chunk_docs d ON d.rowid = f.rowid
            JOIN ref_chunks c ON c.chunk_id = d.chunk_id
            WHERE ref_chunks_fts MATCH ?`;
          const params: unknown[] = [fts_query];
          if (opts?.doc_filter) { sql += " AND c.doc_path LIKE ?"; params.push(`%${opts.doc_filter}%`); }
          sql += " ORDER BY score LIMIT ?";
          params.push(limit * 2);

          const rows = db.prepare(sql).all(...params) as Array<ReferenceSearchResult>;
          for (const r of rows) results.set(r.chunk_id, { ...r, score: Math.abs(r.score) });
        } catch { /* FTS 실패 시 벡터만 사용 */ }
      }

      // 벡터 시멘틱 검색
      if (this.embed_fn) {
        try {
          const { embeddings } = await this.embed_fn([query.slice(0, MAX_EMBED_CHARS)], { dimensions: VEC_DIMENSIONS });
          if (embeddings.length > 0) {
            const qvec = normalize_vec(embeddings[0]);
            const qbuf = new Float32Array(qvec);
            const vec_rows = db.prepare(`
              SELECT v.rowid, v.distance
              FROM ref_chunks_vec v
              WHERE v.embedding MATCH ? AND k = ?
              ORDER BY v.distance
            `).all(qbuf, limit * 2) as { rowid: number; distance: number }[];

            if (vec_rows.length > 0) {
              const rowids = vec_rows.map((r) => r.rowid);
              const placeholders = rowids.map(() => "?").join(",");
              const doc_rows = db.prepare(`
                SELECT d.rowid, d.chunk_id FROM ref_chunk_docs d WHERE d.rowid IN (${placeholders})
              `).all(...rowids) as { rowid: number; chunk_id: string }[];
              const rowid_to_chunk = new Map(doc_rows.map((r) => [r.rowid, r.chunk_id]));

              for (const vr of vec_rows) {
                const chunk_id = rowid_to_chunk.get(vr.rowid);
                if (!chunk_id || results.has(chunk_id)) continue;
                const chunk = db.prepare("SELECT chunk_id, doc_path, heading, content FROM ref_chunks WHERE chunk_id = ?").get(chunk_id) as ReferenceChunk | undefined;
                if (chunk) {
                  results.set(chunk_id, { ...chunk, score: 1 / (1 + vr.distance) });
                }
              }
            }
          }
        } catch { /* 벡터 검색 실패 시 FTS 결과만 사용 */ }
      }

      // 이미지 KNN 검색 (멀티모달 embed가 있을 때만)
      if (this.image_embed_fn) {
        try {
          const { embeddings } = await this.image_embed_fn([query.slice(0, MAX_EMBED_CHARS)], { dimensions: VEC_DIMENSIONS });
          if (embeddings.length > 0) {
            const qvec = normalize_vec(embeddings[0]!);
            const qbuf = new Float32Array(qvec);
            const img_rows = db.prepare(`
              SELECT v.rowid, v.distance
              FROM ref_image_chunks_vec v
              WHERE v.embedding MATCH ? AND k = ?
              ORDER BY v.distance
            `).all(qbuf, limit) as { rowid: number; distance: number }[];

            for (const vr of img_rows) {
              const chunk = db.prepare(
                "SELECT chunk_id, doc_path, heading, content FROM ref_chunks WHERE rowid = ?",
              ).get(vr.rowid) as ReferenceChunk | undefined;
              if (chunk && !results.has(chunk.chunk_id)) {
                results.set(chunk.chunk_id, { ...chunk, score: 1 / (1 + vr.distance) });
              }
            }
          }
        } catch { /* 이미지 검색 실패 시 무시 */ }
      }
    } finally {
      db.close();
    }

    // 점수순 정렬 + limit
    return [...results.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  list_documents(): { path: string; chunks: number; size: number; updated_at: string }[] {
    this.ensure_init();
    const db = new Database(this.db_path, { readonly: true });
    try {
      return db.prepare("SELECT path, chunk_count as chunks, file_size as size, updated_at FROM ref_documents ORDER BY updated_at DESC").all() as Array<{ path: string; chunks: number; size: number; updated_at: string }>;
    } finally {
      db.close();
    }
  }

  get_stats(): { total_docs: number; total_chunks: number; last_sync: string | null } {
    this.ensure_init();
    const db = new Database(this.db_path, { readonly: true });
    try {
      const docs = (db.prepare("SELECT COUNT(*) as c FROM ref_documents").get() as { c: number } | undefined)?.c ?? 0;
      const chunks = (db.prepare("SELECT COUNT(*) as c FROM ref_chunks").get() as { c: number } | undefined)?.c ?? 0;
      return { total_docs: docs, total_chunks: chunks, last_sync: this.last_sync ? new Date(this.last_sync).toISOString() : null };
    } finally {
      db.close();
    }
  }

  // ── Private ──

  private scan_files(dir: string, base?: string): { rel_path: string; abs_path: string }[] {
    const result: { rel_path: string; abs_path: string }[] = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const abs = join(dir, entry.name);
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          result.push(...this.scan_files(abs, rel));
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) result.push({ rel_path: rel, abs_path: abs });
        }
      }
    } catch { /* 읽기 실패 시 무시 */ }
    return result;
  }

  private chunk_text(content: string, source_path: string): ReferenceChunk[] {
    const ext = extname(source_path).toLowerCase();
    if (ext === ".md") return this.chunk_markdown(content, source_path);
    return this.chunk_fixed(content, source_path);
  }

  private chunk_markdown(content: string, source_path: string): ReferenceChunk[] {
    const lines = content.split(/\r?\n/);
    const chunks: ReferenceChunk[] = [];
    let heading = "";
    let buf: string[] = [];
    let start = 1;

    const flush = () => {
      const text = buf.join("\n").trim();
      if (text) {
        chunks.push({
          chunk_id: sha256_short(`${source_path}:${start}:${start + buf.length}`),
          doc_path: source_path,
          heading,
          content: text,
          start_line: start,
          end_line: start + buf.length - 1,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
      if (m) {
        flush();
        heading = m[2].trim();
        buf = [lines[i]];
        start = i + 1;
        continue;
      }
      buf.push(lines[i]);
      // 청크 크기 초과 시 분할
      if (buf.join("\n").length > CHUNK_SIZE) {
        const prev_start = start;
        flush();
        // overlap이 전체 버퍼와 동일하면 start가 진행되지 않아 중복 chunk_id 발생 → 초기화
        const overlap_lines = buf.slice(-3);
        const next_start = i - overlap_lines.length + 2;
        if (next_start > prev_start) {
          buf = [...overlap_lines];
          start = next_start;
        } else {
          buf = [];
          start = i + 2;
        }
      }
    }
    flush();
    return chunks;
  }

  private chunk_fixed(content: string, source_path: string): ReferenceChunk[] {
    const lines = content.split(/\r?\n/);
    const chunks: ReferenceChunk[] = [];
    let buf: string[] = [];
    let start = 1;

    for (let i = 0; i < lines.length; i++) {
      buf.push(lines[i]);
      if (buf.join("\n").length > CHUNK_SIZE) {
        const text = buf.join("\n").trim();
        if (text) {
          chunks.push({
            chunk_id: sha256_short(`${source_path}:${start}:${i + 1}`),
            doc_path: source_path,
            heading: "",
            content: text,
            start_line: start,
            end_line: i + 1,
          });
        }
        // overlap이 전체 버퍼와 동일하면 start가 진행되지 않아 중복 chunk_id 발생 → 초기화
        const overlap = buf.slice(-3);
        const next_start = i - overlap.length + 2;
        if (next_start > start) {
          buf = [...overlap];
          start = next_start;
        } else {
          buf = [];
          start = i + 2;
        }
      }
    }
    // 남은 버퍼
    const text = buf.join("\n").trim();
    if (text) {
      chunks.push({
        chunk_id: sha256_short(`${source_path}:${start}:${lines.length}`),
        doc_path: source_path,
        heading: "",
        content: text,
        start_line: start,
        end_line: lines.length,
      });
    }
    return chunks;
  }

  private remove_document(db: Database.Database, path: string): void {
    // 벡터 삭제: ref_chunk_docs의 rowid 기준
    const rows = db.prepare("SELECT rowid FROM ref_chunk_docs WHERE chunk_id IN (SELECT chunk_id FROM ref_chunks WHERE doc_path = ?)").all(path) as { rowid: number }[];
    if (rows.length > 0) {
      const placeholders = rows.map(() => "?").join(",");
      const rowids = rows.map((r) => r.rowid);
      try { db.prepare(`DELETE FROM ref_chunks_vec WHERE rowid IN (${placeholders})`).run(...rowids); } catch { /* vec table may not exist */ }
      db.prepare(`DELETE FROM ref_chunks_fts WHERE rowid IN (${placeholders})`).run(...rowids);
      db.prepare(`DELETE FROM ref_chunk_docs WHERE rowid IN (${placeholders})`).run(...rowids);
    }
    db.prepare("DELETE FROM ref_chunks WHERE doc_path = ?").run(path);
    db.prepare("DELETE FROM ref_documents WHERE path = ?").run(path);
  }

  /**
   * 이미지 청크 벡터 임베딩. ref_chunk_docs rowid 없이 ref_media rowid 기준으로 저장.
   * 이미지는 FTS에 없으므로 ref_chunks_vec에 직접 rowid 지정 불가 → image_vec 별도 테이블 사용.
   */
  private async embed_image_chunks(db: Database.Database, items: { chunk_id: string; data_url: string }[]): Promise<void> {
    if (!this.image_embed_fn || items.length === 0) return;
    const BATCH_SIZE = 16; // 이미지는 페이로드가 크므로 배치 작게

    // 이미지용 vec0 테이블이 없으면 생성
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ref_image_chunks_vec USING vec0(embedding float[${VEC_DIMENSIONS}])`);
    } catch { /* 이미 있으면 무시 */ }

    const ins_img_vec = db.prepare("INSERT INTO ref_image_chunks_vec (rowid, embedding) VALUES (?, ?)");
    const del_img_vec = db.prepare("DELETE FROM ref_image_chunks_vec WHERE rowid = ?");
    // ref_chunks rowid를 image_vec rowid로 사용
    const get_rowid = db.prepare("SELECT rowid FROM ref_chunks WHERE chunk_id = ?");

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      try {
        const { embeddings } = await this.image_embed_fn(
          batch.map((b) => ({ image_data_url: b.data_url })),
          { dimensions: VEC_DIMENSIONS },
        );
        const tx = db.transaction(() => {
          for (let j = 0; j < batch.length; j++) {
            const row = get_rowid.get(batch[j]!.chunk_id) as { rowid: number } | undefined;
            if (!row) continue;
            const vec = normalize_vec(embeddings[j]!);
            try { del_img_vec.run(row.rowid); } catch { /* 없을 수 있음 */ }
            ins_img_vec.run(row.rowid, new Float32Array(vec));
          }
        });
        tx();
      } catch { /* 이미지 임베딩 실패 시 경로만 저장된 상태 유지 */ }
    }
  }

  private async embed_chunks(db: Database.Database, items: { chunk_id: string; text: string }[]): Promise<void> {
    if (!this.embed_fn || items.length === 0) return;

    const BATCH_SIZE = 96;
    const del_vec = db.prepare("DELETE FROM ref_chunks_vec WHERE rowid = ?");
    const ins_vec = db.prepare("INSERT INTO ref_chunks_vec (rowid, embedding) VALUES (?, ?)");

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const texts = batch.map((b) => b.text);

      try {
        const { embeddings } = await this.embed_fn(texts, { dimensions: VEC_DIMENSIONS });

        // chunk_id → ref_chunk_docs rowid 매핑
        const chunk_ids = batch.map((b) => b.chunk_id);
        const placeholders = chunk_ids.map(() => "?").join(",");
        const rows = db.prepare(`SELECT rowid, chunk_id FROM ref_chunk_docs WHERE chunk_id IN (${placeholders})`).all(...chunk_ids) as { rowid: number; chunk_id: string }[];
        const id_to_rowid = new Map(rows.map((r) => [r.chunk_id, r.rowid]));

        const tx = db.transaction(() => {
          for (let j = 0; j < batch.length; j++) {
            const rowid = id_to_rowid.get(batch[j].chunk_id);
            if (rowid === undefined) continue;
            const vec = normalize_vec(embeddings[j]);
            const buf = new Float32Array(vec);
            try { del_vec.run(rowid); } catch { /* 없을 수 있음 */ }
            ins_vec.run(rowid, buf);
          }
        });
        tx();
      } catch { /* 임베딩 실패 시 벡터 없이 FTS만 사용 */ }
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
