import { mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { RechunkJob } from "./memory-rechunk-worker.js";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type {
  ConsolidationMessage,
  ConsolidationSession,
  LlmProviderLike,
  MemoryConsolidateOptions,
  MemoryConsolidateResult,
  MemoryKind,
  MemoryStoreLike,
} from "./memory.types.js";
import { today_key, now_iso} from "../utils/common.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { sanitize_untrusted_text } from "../security/content-sanitizer.js";
import { get_shared_secret_vault } from "../security/secret-vault-factory.js";
import { parse_tool_calls_from_text } from "./tool-call-parser.js";
import { chunk_markdown } from "./memory-chunker.js";
import { rrf_merge, apply_temporal_decay, mmr_rerank } from "./memory-scoring.js";

const SAVE_MEMORY_TOOL = [
  {
    name: "save_memory",
    description: "Persist consolidated history and new long-term memory insights.",
    input_schema: {
      type: "object",
      properties: {
        history_entry: { type: "string", description: "Append-only history summary entry" },
        memory_new_insights: { type: "string", description: "New facts, conclusions, and insights NOT already present in current long-term memory. Do NOT repeat existing content." },
      },
      required: [],
    },
  },
];

function is_day_key(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || "").trim());
}

type MemoryDocRow = {
  path: string;
  content: string;
};

/** 임베딩 함수 시그니처. 없으면 벡터 검색 비활성. */
export type EmbedFn = (texts: string[], opts: { model?: string; dimensions?: number }) => Promise<{ embeddings: number[][] }>;

const VEC_DIMENSIONS = 256;
/** 임베딩 입력 최대 문자 수 (초과 시 truncate). */
const MAX_EMBED_CHARS = 2000;

export class MemoryStore implements MemoryStoreLike {
  private readonly root: string;
  private readonly memory_dir: string;
  private readonly sqlite_path: string;
  private readonly initialized: Promise<void>;
  private embed_fn: EmbedFn | null = null;
  private embed_worker_config: import("./memory.types.js").EmbedWorkerConfig | null = null;
  private rechunk_worker: Worker | null = null;

  constructor(workspace_root: string) {
    this.root = workspace_root;
    this.memory_dir = join(this.root, "memory");
    this.sqlite_path = join(this.memory_dir, "memory.db");
    this.initialized = this.ensure_initialized();
  }

  /** 임베딩 서비스를 late-inject. 설정 후 벡터 시맨틱 검색 활성화. */
  set_embed(fn: EmbedFn): void { this.embed_fn = fn; }

  /** 워커 스레드용 임베딩 API 설정 주입. */
  set_embed_worker_config(config: import("./memory.types.js").EmbedWorkerConfig): void {
    this.embed_worker_config = config;
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.memory_dir, { recursive: true });
    with_sqlite_strict(this.sqlite_path,(db) => {
      db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS memory_documents (
          doc_key TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          day TEXT NOT NULL,
          path TEXT NOT NULL,
          content TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memory_documents_kind_day
          ON memory_documents(kind, day, updated_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_documents_fts USING fts5(
          content,
          kind UNINDEXED,
          day UNINDEXED,
          path UNINDEXED,
          content='memory_documents',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS memory_documents_ai AFTER INSERT ON memory_documents BEGIN
          INSERT INTO memory_documents_fts(rowid, content, kind, day, path)
          VALUES (new.rowid, new.content, new.kind, new.day, new.path);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_documents_ad AFTER DELETE ON memory_documents BEGIN
          INSERT INTO memory_documents_fts(memory_documents_fts, rowid, content, kind, day, path)
          VALUES ('delete', old.rowid, old.content, old.kind, old.day, old.path);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_documents_au AFTER UPDATE ON memory_documents BEGIN
          INSERT INTO memory_documents_fts(memory_documents_fts, rowid, content, kind, day, path)
          VALUES ('delete', old.rowid, old.content, old.kind, old.day, old.path);
          INSERT INTO memory_documents_fts(rowid, content, kind, day, path)
          VALUES (new.rowid, new.content, new.kind, new.day, new.path);
        END;
      `);

      // 벡터 검색용 hash 컬럼 (content 변경 감지)
      try {
        db.exec(`ALTER TABLE memory_documents ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''`);
      } catch { /* 이미 존재 */ }

      // 청크 기반 검색 인덱스 (memsearch 방식)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_chunks (
          chunk_id     TEXT PRIMARY KEY,
          doc_key      TEXT NOT NULL,
          kind         TEXT NOT NULL,
          day          TEXT NOT NULL DEFAULT '',
          heading      TEXT NOT NULL DEFAULT '',
          start_line   INTEGER NOT NULL DEFAULT 0,
          end_line     INTEGER NOT NULL DEFAULT 0,
          content      TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_doc ON memory_chunks(doc_key);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
          content,
          content='memory_chunks',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
          INSERT INTO memory_chunks_fts(rowid, content)
          VALUES (new.rowid, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
          INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content)
          VALUES ('delete', old.rowid, old.content);
        END;
      `);

      sqliteVec.load(db);
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec
        USING vec0(embedding float[${VEC_DIMENSIONS}])
      `);
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_vec
        USING vec0(embedding float[${VEC_DIMENSIONS}])
      `);

      return true;
    });
    this.ensure_longterm_document();
  }

  private normalize_day_key(day?: string): string {
    const raw = String(day || "").trim();
    return is_day_key(raw) ? raw : today_key();
  }

  private longterm_doc_key(): string {
    return "longterm:MEMORY";
  }

  private daily_doc_key(day: string): string {
    return `daily:${day}`;
  }

  private longterm_uri(): string {
    return "sqlite://memory/longterm";
  }

  private daily_uri(day: string): string {
    return `sqlite://memory/daily/${day}`;
  }

  private ensure_longterm_document(): void {
    const row = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT doc_key
      FROM memory_documents
      WHERE doc_key = ?
      LIMIT 1
    `).get(this.longterm_doc_key()) as { doc_key: string } | undefined) || undefined;
    if (row) return;
    this.sqlite_upsert_document("longterm", "__longterm__", this.longterm_uri(), "");
  }

  private sqlite_upsert_document(kind: "longterm" | "daily", day: string, path: string, content: string): void {
    const doc_key = kind === "longterm" ? this.longterm_doc_key() : this.daily_doc_key(day);
    with_sqlite(this.sqlite_path,(db) => {
      db.prepare(`
        INSERT INTO memory_documents (doc_key, kind, day, path, content, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_key) DO UPDATE SET
          kind = excluded.kind,
          day = excluded.day,
          path = excluded.path,
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(doc_key, kind, day, path, String(content || ""), now_iso());
      return true;
    });
    this.schedule_rechunk(doc_key, kind, day, String(content || ""));
  }

  /** SQL-level atomic append — TOCTOU 방지. */
  private sqlite_append_document(kind: "longterm" | "daily", day: string, path: string, content: string): void {
    const doc_key = kind === "longterm" ? this.longterm_doc_key() : this.daily_doc_key(day);
    with_sqlite(this.sqlite_path,(db) => {
      db.prepare(`
        INSERT INTO memory_documents (doc_key, kind, day, path, content, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_key) DO UPDATE SET
          content = memory_documents.content || excluded.content,
          updated_at = excluded.updated_at
      `).run(doc_key, kind, day, path, String(content || ""), now_iso());
      return true;
    });
    // append 후 전체 문서를 다시 읽어 워커에서 re-chunk
    const full = this.sqlite_read_document(kind, day);
    if (full?.content) this.schedule_rechunk(doc_key, kind, day, full.content);
  }

  /** 청킹 워커를 lazy singleton으로 반환. */
  private get_rechunk_worker(): Worker {
    if (!this.rechunk_worker) {
      const __dir = dirname(fileURLToPath(import.meta.url));
      const is_tsx = import.meta.url.endsWith(".ts");
      const worker_file = resolve(__dir, is_tsx ? "memory-rechunk-worker.ts" : "memory-rechunk-worker.js");
      this.rechunk_worker = new Worker(worker_file, {
        execArgv: is_tsx ? ["--import", "tsx"] : [],
      });
      // 프로세스 종료 시 워커를 강제 대기하지 않음
      this.rechunk_worker.unref();
      this.rechunk_worker.on("error", (err) => {
        process.stderr.write(`[rechunk-worker] error: ${err.message}\n`);
        this.rechunk_worker = null;
      });
    }
    return this.rechunk_worker;
  }

  /** 청킹(+ 임베딩)을 워커 스레드로 위임. 메인 스레드 블로킹 없음. */
  private schedule_rechunk(doc_key: string, kind: string, day: string, content: string): void {
    try {
      const job: RechunkJob = {
        sqlite_path: this.sqlite_path,
        doc_key, kind, day, content,
        embed: this.embed_worker_config ?? undefined,
      };
      this.get_rechunk_worker().postMessage(job);
    } catch {
      // 워커 실패 시 무시 — 청킹은 eventual consistency 허용
    }
  }

  /** 문서의 청크 인덱스를 갱신. 변경된 청크만 upsert, 삭제된 청크 제거. */
  private rechunk_document(doc_key: string, kind: string, day: string, content: string): void {
    const new_chunks = chunk_markdown(content, doc_key);
    const new_ids = new Set(new_chunks.map(c => c.chunk_id));

    with_sqlite(this.sqlite_path, (db) => {
      // 기존 청크 중 새 목록에 없는 것 삭제
      const existing = db.prepare(
        "SELECT chunk_id, content_hash FROM memory_chunks WHERE doc_key = ?",
      ).all(doc_key) as { chunk_id: string; content_hash: string }[];

      const existing_map = new Map(existing.map(r => [r.chunk_id, r.content_hash]));
      const to_delete = existing.filter(r => !new_ids.has(r.chunk_id)).map(r => r.chunk_id);

      if (to_delete.length > 0) {
        const del_chunk = db.prepare("DELETE FROM memory_chunks WHERE chunk_id = ?");
        for (const id of to_delete) del_chunk.run(id);
      }

      // 새 청크 중 변경된 것만 upsert
      const upsert = db.prepare(`
        INSERT INTO memory_chunks (chunk_id, doc_key, kind, day, heading, start_line, end_line, content, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          content = excluded.content,
          content_hash = excluded.content_hash
      `);

      for (const c of new_chunks) {
        if (existing_map.get(c.chunk_id) === c.content_hash) continue; // 불변
        upsert.run(c.chunk_id, doc_key, kind, day, c.heading, c.start_line, c.end_line, c.content, c.content_hash);
      }

      return true;
    });
  }

  private sqlite_read_document(kind: "longterm" | "daily", day: string): MemoryDocRow | null {
    const doc_key = kind === "longterm" ? this.longterm_doc_key() : this.daily_doc_key(day);
    const row = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT path, content
      FROM memory_documents
      WHERE doc_key = ?
      LIMIT 1
    `).get(doc_key) as MemoryDocRow | undefined) || undefined;
    if (!row) return null;
    return {
      path: String(row.path || ""),
      content: String(row.content || ""),
    };
  }

  private sqlite_delete_daily(day: string): boolean {
    const removed = with_sqlite(this.sqlite_path,(db) => {
      const result = db.prepare("DELETE FROM memory_documents WHERE doc_key = ?").run(this.daily_doc_key(day));
      return Number(result.changes || 0);
    }) || 0;
    return removed > 0;
  }

  private build_fts_query(query: string): string {
    const terms = String(query || "")
      .split(/\s+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (terms.length === 0) return "";
    return terms.map((v) => `"${v.replace(/"/g, "\"\"")}"`).join(" ");
  }

  async get_paths(): Promise<{ workspace: string; memoryDir: string; sqlitePath: string }> {
    await this.initialized;
    return {
      workspace: this.root,
      memoryDir: this.memory_dir,
      sqlitePath: this.sqlite_path,
    };
  }

  async resolve_daily_path(day?: string): Promise<string> {
    await this.initialized;
    return this.daily_uri(this.normalize_day_key(day));
  }

  async list_daily(): Promise<string[]> {
    await this.initialized;
    const rows = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT day
      FROM memory_documents
      WHERE kind = 'daily'
      ORDER BY day ASC
    `).all() as Array<{ day: string }>) || [];
    return rows
      .map((row) => String(row.day || ""))
      .filter((day) => is_day_key(day));
  }

  async read_longterm(): Promise<string> {
    await this.initialized;
    const row = this.sqlite_read_document("longterm", "__longterm__");
    return row?.content || "";
  }

  async write_longterm(content: string): Promise<void> {
    await this.initialized;
    this.sqlite_upsert_document("longterm", "__longterm__", this.longterm_uri(), String(content || ""));
  }

  async append_longterm(content: string): Promise<void> {
    await this.initialized;
    this.sqlite_append_document("longterm", "__longterm__", this.longterm_uri(), String(content || ""));
  }

  async read_daily(day?: string): Promise<string> {
    await this.initialized;
    const day_key = this.normalize_day_key(day);
    const row = this.sqlite_read_document("daily", day_key);
    return row?.content || "";
  }

  async write_daily(content: string, day?: string): Promise<void> {
    await this.initialized;
    const day_key = this.normalize_day_key(day);
    this.sqlite_upsert_document("daily", day_key, this.daily_uri(day_key), String(content || ""));
  }

  async append_daily(content: string, day?: string): Promise<void> {
    await this.initialized;
    const day_key = this.normalize_day_key(day);
    this.sqlite_append_document("daily", day_key, this.daily_uri(day_key), String(content || ""));
  }

  async save_memory(args: {
    kind: MemoryKind;
    content: string;
    mode?: "append" | "overwrite";
    day?: string;
  }): Promise<{ ok: boolean; target: string }> {
    const mode = args.mode || "append";
    if (args.kind === "longterm") {
      if (mode === "overwrite") await this.write_longterm(args.content);
      else await this.append_longterm(args.content);
      return { ok: true, target: this.longterm_uri() };
    }
    const day_key = this.normalize_day_key(args.day);
    if (mode === "overwrite") await this.write_daily(args.content, day_key);
    else await this.append_daily(args.content, day_key);
    return { ok: true, target: this.daily_uri(day_key) };
  }

  async search(
    query: string,
    args?: { kind?: "all" | MemoryKind; day?: string; limit?: number; case_sensitive?: boolean },
  ): Promise<Array<{ file: string; line: number; text: string }>> {
    await this.initialized;
    const limit = Math.max(1, Number(args?.limit || 20));
    const raw_query = String(query || "").trim();
    if (!raw_query) return [];

    const kind = args?.kind || "all";
    const day = String(args?.day || "").trim();
    const candidate_k = Math.max(limit * 3, 30);

    // 1) FTS5 청크 검색 (BM25 랭킹)
    const fts_ranked = this.search_chunks_fts(raw_query, kind, day, candidate_k);

    // 2) 벡터 청크 검색 (KNN)
    const vec_ranked = await this.search_chunks_vec(raw_query, kind, day, candidate_k);

    // 3) RRF 스코어 융합
    let scored = rrf_merge(fts_ranked, vec_ranked);

    // 4) 시간 감쇠 (longterm은 면제)
    const chunk_age_cache = new Map<string, number | null>();
    const age_fn = (chunk_id: string): number | null => {
      if (chunk_age_cache.has(chunk_id)) return chunk_age_cache.get(chunk_id)!;
      const meta = this.get_chunk_meta(chunk_id);
      const age = meta ? chunk_age_days(meta.kind, meta.day) : null;
      chunk_age_cache.set(chunk_id, age);
      return age;
    };
    scored = apply_temporal_decay(scored, age_fn);

    // 5) MMR 다양성 리랭킹
    const chunk_content_cache = new Map<string, string>();
    const content_fn = (chunk_id: string): string => {
      if (chunk_content_cache.has(chunk_id)) return chunk_content_cache.get(chunk_id)!;
      const c = this.get_chunk_content(chunk_id);
      chunk_content_cache.set(chunk_id, c);
      return c;
    };
    scored = mmr_rerank(scored, content_fn, limit);

    // 6) 결과 포맷 (기존 인터페이스 호환)
    const out: Array<{ file: string; line: number; text: string }> = [];
    for (const { chunk_id } of scored) {
      const meta = this.get_chunk_meta(chunk_id);
      if (!meta) continue;
      const heading_prefix = meta.heading ? `[${meta.heading}] ` : "";
      const lines = meta.content.split(/\r?\n/).filter(Boolean);
      const preview = lines.slice(0, 3).join(" | ");
      out.push({
        file: meta.doc_key.replace(":", "/"),
        line: meta.start_line,
        text: `${heading_prefix}${preview}`,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** FTS5로 청크 검색, chunk_id 순위 리스트 반환. */
  private search_chunks_fts(query: string, kind: string, day: string, top_k: number): string[] {
    const fts_query = this.build_fts_query(query);
    if (!fts_query) return [];

    const where: string[] = ["memory_chunks_fts MATCH ?"];
    const bind: Array<string | number> = [fts_query];
    if (kind === "longterm") { where.push("c.kind = ?"); bind.push("longterm"); }
    else if (kind === "daily") {
      where.push("c.kind = ?"); bind.push("daily");
      if (is_day_key(day)) { where.push("c.day = ?"); bind.push(day); }
    } else if (is_day_key(day)) { where.push("c.day = ?"); bind.push(day); }
    bind.push(top_k);

    return with_sqlite(this.sqlite_path, (db) => {
      const rows = db.prepare(`
        SELECT c.chunk_id
        FROM memory_chunks_fts f
        JOIN memory_chunks c ON c.rowid = f.rowid
        WHERE ${where.join(" AND ")}
        ORDER BY bm25(memory_chunks_fts)
        LIMIT ?
      `).all(...bind) as { chunk_id: string }[];
      return rows.map(r => r.chunk_id);
    }) || [];
  }

  /** 벡터 KNN으로 청크 검색, chunk_id 순위 리스트 반환. */
  private async search_chunks_vec(query: string, kind: string, day: string, top_k: number): Promise<string[]> {
    if (!this.embed_fn) return [];

    try {
      await this.ensure_chunk_embeddings_fresh();

      const { embeddings } = await this.embed_fn([query.slice(0, MAX_EMBED_CHARS)], { dimensions: VEC_DIMENSIONS });
      if (!embeddings?.[0]?.length) return [];
      const query_vec = normalize_vec(embeddings[0]);

      let db: Database.Database | null = null;
      try {
        db = new Database(this.sqlite_path, { readonly: true });
        sqliteVec.load(db);

        const rows = db.prepare(`
          SELECT v.rowid, v.distance
          FROM memory_chunks_vec v
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance
        `).all(query_vec, top_k) as { rowid: number; distance: number }[];

        if (!rows.length) return [];

        // rowid → chunk_id 매핑
        const rowids = rows.map(r => r.rowid);
        const placeholders = rowids.map(() => "?").join(",");

        // kind/day 필터 적용
        let filter = "";
        const bind_extra: string[] = [];
        if (kind === "longterm") { filter = "AND c.kind = ?"; bind_extra.push("longterm"); }
        else if (kind === "daily") {
          filter = "AND c.kind = ?"; bind_extra.push("daily");
          if (is_day_key(day)) { filter += " AND c.day = ?"; bind_extra.push(day); }
        } else if (is_day_key(day)) { filter = "AND c.day = ?"; bind_extra.push(day); }

        const chunk_rows = db.prepare(
          `SELECT chunk_id FROM memory_chunks c WHERE c.rowid IN (${placeholders}) ${filter}`,
        ).all(...rowids, ...bind_extra) as { chunk_id: string }[];

        return chunk_rows.map(r => r.chunk_id);
      } finally {
        try { db?.close(); } catch { /* no-op */ }
      }
    } catch {
      return [];
    }
  }

  /** 임베딩이 없는 청크를 배치 임베딩. */
  private async ensure_chunk_embeddings_fresh(): Promise<void> {
    if (!this.embed_fn) return;

    const stale = with_sqlite(this.sqlite_path, (db) => db.prepare(`
      SELECT c.rowid, c.chunk_id, c.content, c.content_hash
      FROM memory_chunks c
      WHERE c.content != ''
        AND NOT EXISTS (SELECT 1 FROM memory_chunks_vec v WHERE v.rowid = c.rowid)
    `).all() as Array<{ rowid: number; chunk_id: string; content: string; content_hash: string }>) || [];

    if (stale.length === 0) return;

    const texts = stale.map(r => r.content.slice(0, MAX_EMBED_CHARS));
    const { embeddings } = await this.embed_fn(texts, { dimensions: VEC_DIMENSIONS });
    if (!embeddings || embeddings.length !== stale.length) return;

    let db: Database.Database | null = null;
    try {
      db = new Database(this.sqlite_path);
      db.pragma("journal_mode=WAL");
      sqliteVec.load(db);

      const ins_vec = db.prepare("INSERT OR REPLACE INTO memory_chunks_vec (rowid, embedding) VALUES (?, ?)");
      const tx = db.transaction(() => {
        for (let i = 0; i < stale.length; i++) {
          ins_vec.run(BigInt(stale[i].rowid), normalize_vec(embeddings[i]));
        }
      });
      tx();
    } finally {
      try { db?.close(); } catch { /* no-op */ }
    }
  }

  private get_chunk_meta(chunk_id: string): { doc_key: string; kind: string; day: string; heading: string; start_line: number; content: string } | null {
    return with_sqlite(this.sqlite_path, (db) => db.prepare(
      "SELECT doc_key, kind, day, heading, start_line, content FROM memory_chunks WHERE chunk_id = ?",
    ).get(chunk_id) as { doc_key: string; kind: string; day: string; heading: string; start_line: number; content: string } | undefined) || null;
  }

  private get_chunk_content(chunk_id: string): string {
    return with_sqlite(this.sqlite_path, (db) => {
      const row = db.prepare("SELECT content FROM memory_chunks WHERE chunk_id = ?").get(chunk_id) as { content: string } | undefined;
      return row?.content || "";
    }) || "";
  }

  async consolidate(options?: MemoryConsolidateOptions): Promise<MemoryConsolidateResult> {
    await this.initialized;
    const window_days = Math.max(1, Math.min(365, Number(options?.memory_window || 7)));
    const now = new Date();
    const days = await this.list_daily();
    const used: string[] = [];
    const archived: string[] = [];
    const chunks: string[] = [];

    for (const day of days) {
      if (!is_day_key(day)) continue;
      const d = new Date(`${day}T00:00:00Z`);
      if (!Number.isFinite(d.getTime())) continue;
      const age = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (age > window_days) continue;
      const content = (await this.read_daily(day)).trim();
      if (!content) continue;
      used.push(day);
      chunks.push(`## Daily ${day}\n${content}`);
    }

    const longterm_raw = (await this.read_longterm()).trim();
    const header = [
      `\n## Consolidated ${today_key()}`,
      `- session: ${options?.session || "n/a"}`,
      `- provider: ${options?.provider || "n/a"}`,
      `- model: ${options?.model || "n/a"}`,
      `- memory_window_days: ${window_days}`,
      "",
    ].join("\n");
    const body = chunks.join("\n\n");
    const block = body ? `${header}${body}\n` : `${header}- no daily content in window\n`;
    await this.append_longterm(block);

    const compressed_prompt = [
      "# COMPRESSED MEMORY PROMPT",
      "",
      "## Longterm",
      longterm_raw || "(empty)",
      "",
      "## Recent Daily",
      body || "(no daily content in window)",
      "",
      "## Runtime Context",
      `session=${options?.session || "n/a"}`,
      `provider=${options?.provider || "n/a"}`,
      `model=${options?.model || "n/a"}`,
      `memory_window_days=${window_days}`,
      "",
      "## Injection Rule",
      "- Use this prompt as the primary bootstrap context.",
      "- Prefer longterm decisions; use daily memory for latest execution details.",
    ].join("\n");

    if (options?.archive) {
      for (const day of used) {
        if (!is_day_key(day)) continue;
        if (!this.sqlite_delete_daily(day)) continue;
        archived.push(`sqlite://memory/archive/daily/${day}`);
      }
    }

    return {
      ok: true,
      longterm_appended_chars: block.length,
      daily_entries_used: used,
      archived_files: archived,
      summary: body ? `consolidated ${used.length} daily entries` : "no daily entries consolidated",
      compressed_prompt,
    };
  }

  async consolidate_with_provider(
    session: ConsolidationSession,
    provider: LlmProviderLike,
    model: string,
    options?: { archive_all?: boolean; memory_window?: number },
  ): Promise<boolean> {
    const secret_vault = get_shared_secret_vault(this.root);
    const archive_all = !!options?.archive_all;
    const memory_window = Math.max(4, Number(options?.memory_window || 50));

    let old_messages: ConsolidationMessage[] = [];
    let keep_count = 0;
    if (archive_all) {
      old_messages = session.messages;
      keep_count = 0;
    } else {
      keep_count = Math.floor(memory_window / 2);
      if (session.messages.length <= keep_count) return true;
      if (session.messages.length - Number(session.last_consolidated || 0) <= 0) return true;
      old_messages = session.messages.slice(
        Number(session.last_consolidated || 0),
        Math.max(0, session.messages.length - keep_count),
      );
      if (old_messages.length === 0) return true;
    }

    const lines: string[] = [];
    for (const m of old_messages) {
      if (!m?.content) continue;
      const tools = Array.isArray(m.tools_used) && m.tools_used.length > 0
        ? ` [tools: ${m.tools_used.join(", ")}]`
        : "";
      const ts = String(m.timestamp || "?").slice(0, 16);
      const masked = redact_sensitive_text(await secret_vault.mask_known_secrets(String(m.content))).text;
      lines.push(`[${ts}] ${String(m.role || "unknown").toUpperCase()}${tools}: ${masked}`);
    }
    if (lines.length === 0) return true;

    const current_memory = redact_sensitive_text(await secret_vault.mask_known_secrets(await this.read_longterm())).text;
    const prompt = [
      "Process this conversation and call the save_memory tool with your consolidation.",
      "",
      "## Current Long-term Memory",
      current_memory || "(empty)",
      "",
      "## Conversation to Process",
      lines.join("\n"),
    ].join("\n");

    const response = await provider.chat({
      messages: [
        {
          role: "system",
          content: "You are a memory consolidation agent. Call the save_memory tool with your consolidation of the conversation.",
        },
        { role: "user", content: prompt },
      ],
      tools: SAVE_MEMORY_TOOL,
      model,
    });

    const implicit_tool_calls = response?.has_tool_calls
      ? []
      : parse_tool_calls_from_text(String(response?.content || ""));
    const effective_tool_calls = response?.has_tool_calls
      ? (Array.isArray(response.tool_calls) ? response.tool_calls : [])
      : implicit_tool_calls;
    if (!Array.isArray(effective_tool_calls) || effective_tool_calls.length === 0) {
      return false;
    }
    const args = effective_tool_calls[0]?.arguments || {};

    const history_entry = args.history_entry;
    if (history_entry !== undefined && history_entry !== null) {
      const raw = typeof history_entry === "string" ? history_entry : JSON.stringify(history_entry);
      const text = sanitize_untrusted_text(raw).text;
      if (text.trim()) await this.append_daily(`${text}\n`);
    }

    const memory_new_insights = args.memory_new_insights ?? args.memory_update; // 하위 호환
    if (memory_new_insights !== undefined && memory_new_insights !== null) {
      const raw = typeof memory_new_insights === "string" ? memory_new_insights : JSON.stringify(memory_new_insights);
      const text = sanitize_untrusted_text(raw).text.trim();
      if (text) await this.append_longterm(`\n${text}\n`);
    }

    session.last_consolidated = archive_all ? 0 : Math.max(0, session.messages.length - keep_count);
    return true;
  }
}

/** L2 단위 벡터로 정규화. */
function normalize_vec(v: number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** 청크의 나이(일)를 계산. longterm → null (evergreen, 감쇠 면제). */
function chunk_age_days(kind: string, day: string): number | null {
  if (kind !== "daily" || !is_day_key(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

/** 간단한 content hash (FNV-1a 32bit). crypto 의존 없이 빠른 변경 감지. */
function _simple_hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
