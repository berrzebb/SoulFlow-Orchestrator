import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { with_sqlite } from "../utils/sqlite-helper.js";
import type { DecisionIndexData, DecisionRecord } from "./types.js";
import { now_iso } from "../utils/common.js";

const INDEX_VERSION = 1;

function default_index(): DecisionIndexData {
  return {
    version: INDEX_VERSION,
    records: {},
    active_by_key: {},
    fingerprints: {},
    updated_at: now_iso(),
  };
}

function key_ref(scope: string, scope_id: string | null | undefined, canonical_key: string): string {
  return `${scope}:${String(scope_id || "")}:${canonical_key}`;
}

export class DecisionStore {
  readonly root: string;
  readonly decisions_dir: string;
  readonly sqlite_path: string;
  private cache: DecisionIndexData | null = null;
  private readonly initialized: Promise<void>;
  private write_queue: Promise<void> = Promise.resolve();

  constructor(root = process.cwd(), decisions_dir_override?: string) {
    this.root = root;
    this.decisions_dir = decisions_dir_override || join(root, "runtime", "decisions");
    this.sqlite_path = join(this.decisions_dir, "decisions.db");
    this.initialized = this.ensure_initialized();
  }

  private async ensure_dirs(): Promise<void> {
    await mkdir(this.decisions_dir, { recursive: true });
  }

  private async ensure_initialized(): Promise<void> {
    await this.ensure_dirs();
    with_sqlite(this.sqlite_path,(db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS decisions (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          scope_id TEXT,
          canonical_key TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          status TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_decisions_scope_key ON decisions(scope, scope_id, canonical_key);
        CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
        CREATE INDEX IF NOT EXISTS idx_decisions_fingerprint ON decisions(fingerprint);
        CREATE INDEX IF NOT EXISTS idx_decisions_updated_at ON decisions(updated_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
          content,
          id UNINDEXED,
          scope UNINDEXED,
          scope_id UNINDEXED,
          canonical_key UNINDEXED,
          status UNINDEXED,
          content='decisions',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
          INSERT INTO decisions_fts(rowid, content, id, scope, scope_id, canonical_key, status)
          VALUES (
            new.rowid,
            json_extract(new.record_json, '$.key') || ' ' ||
            json_extract(new.record_json, '$.value') || ' ' ||
            COALESCE(json_extract(new.record_json, '$.rationale'), '') || ' ' ||
            COALESCE(json_extract(new.record_json, '$.tags'), ''),
            new.id,
            new.scope,
            new.scope_id,
            new.canonical_key,
            new.status
          );
        END;
        CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
          INSERT INTO decisions_fts(decisions_fts, rowid, content, id, scope, scope_id, canonical_key, status)
          VALUES (
            'delete',
            old.rowid,
            json_extract(old.record_json, '$.key') || ' ' ||
            json_extract(old.record_json, '$.value') || ' ' ||
            COALESCE(json_extract(old.record_json, '$.rationale'), '') || ' ' ||
            COALESCE(json_extract(old.record_json, '$.tags'), ''),
            old.id,
            old.scope,
            old.scope_id,
            old.canonical_key,
            old.status
          );
        END;
        CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
          INSERT INTO decisions_fts(decisions_fts, rowid, content, id, scope, scope_id, canonical_key, status)
          VALUES (
            'delete',
            old.rowid,
            json_extract(old.record_json, '$.key') || ' ' ||
            json_extract(old.record_json, '$.value') || ' ' ||
            COALESCE(json_extract(old.record_json, '$.rationale'), '') || ' ' ||
            COALESCE(json_extract(old.record_json, '$.tags'), ''),
            old.id,
            old.scope,
            old.scope_id,
            old.canonical_key,
            old.status
          );
          INSERT INTO decisions_fts(rowid, content, id, scope, scope_id, canonical_key, status)
          VALUES (
            new.rowid,
            json_extract(new.record_json, '$.key') || ' ' ||
            json_extract(new.record_json, '$.value') || ' ' ||
            COALESCE(json_extract(new.record_json, '$.rationale'), '') || ' ' ||
            COALESCE(json_extract(new.record_json, '$.tags'), ''),
            new.id,
            new.scope,
            new.scope_id,
            new.canonical_key,
            new.status
          );
        END;
      `);
      return true;
    });
  }

  private async enqueue_write<T>(job: () => Promise<T>): Promise<T> {
    const run = this.write_queue.then(job, job);
    this.write_queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async upsert_records(records: DecisionRecord[]): Promise<void> {
    if (records.length === 0) return;
    with_sqlite(this.sqlite_path,(db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const stmt = db.prepare(`
          INSERT INTO decisions (id, scope, scope_id, canonical_key, normalized_value, status, fingerprint, updated_at, record_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            scope = excluded.scope,
            scope_id = excluded.scope_id,
            canonical_key = excluded.canonical_key,
            normalized_value = excluded.normalized_value,
            status = excluded.status,
            fingerprint = excluded.fingerprint,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json
        `);
        for (const row of records) {
          stmt.run(
            row.id,
            row.scope,
            row.scope_id || null,
            row.canonical_key,
            row.normalized_value,
            row.status,
            row.fingerprint,
            row.updated_at,
            JSON.stringify(row),
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // no-op
        }
        throw error;
      }
      return true;
    });
  }

  private rebuild_maps(index: DecisionIndexData): void {
    index.active_by_key = {};
    index.fingerprints = {};
    for (const record of Object.values(index.records)) {
      if (record.status !== "active") continue;
      index.active_by_key[key_ref(record.scope, record.scope_id, record.canonical_key)] = record.id;
      index.fingerprints[record.fingerprint] = record.id;
    }
  }

  private async rebuild_index_from_store(): Promise<DecisionIndexData> {
    const index = default_index();
    const rows = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT record_json
      FROM decisions
      ORDER BY updated_at ASC
    `).all() as Array<{ record_json: string }>) || [];
    for (const row of rows) {
      try {
        const record = JSON.parse(String(row.record_json || "")) as DecisionRecord;
        if (!record?.id) continue;
        index.records[record.id] = record;
      } catch {
        // skip broken row
      }
    }
    this.rebuild_maps(index);
    index.updated_at = now_iso();
    return index;
  }

  private async load_index(): Promise<DecisionIndexData> {
    await this.initialized;
    if (this.cache) return this.cache;
    this.cache = await this.rebuild_index_from_store();
    return this.cache;
  }

  async transaction<T>(
    fn: (ctx: {
      index: DecisionIndexData;
      append: (record: DecisionRecord) => void;
      key_ref: (scope: string, scope_id: string | null | undefined, canonical_key: string) => string;
      rebuild_maps: () => void;
      }) => Promise<T>,
  ): Promise<T> {
    await this.initialized;
    return this.enqueue_write(async () => {
      const index = await this.load_index();
      const append_buffer: DecisionRecord[] = [];
      const result = await fn({
        index,
        append: (record) => append_buffer.push(record),
        key_ref,
        rebuild_maps: () => this.rebuild_maps(index),
      });
      index.updated_at = now_iso();
      await this.upsert_records(append_buffer);
      this.cache = null;
      return result;
    });
  }

  async list_records(): Promise<DecisionRecord[]> {
    const index = await this.load_index();
    return Object.values(index.records).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
}
