import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DecisionIndexData, DecisionRecord } from "./types.js";
import { file_exists, now_iso } from "../utils/common.js";

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
  readonly store_path: string;
  readonly index_path: string;
  readonly lock_path: string;
  private cache: DecisionIndexData | null = null;

  constructor(root = process.cwd(), decisions_dir_override?: string) {
    this.root = root;
    this.decisions_dir = decisions_dir_override || join(root, "runtime", "decisions");
    this.store_path = join(this.decisions_dir, "store.jsonl");
    this.index_path = join(this.decisions_dir, "index.json");
    this.lock_path = join(this.decisions_dir, ".lock");
  }

  private async ensure_dirs(): Promise<void> {
    await mkdir(this.decisions_dir, { recursive: true });
  }

  private async acquire_lock(timeout_ms = 3000): Promise<void> {
    await this.ensure_dirs();
    const start = Date.now();
    while (true) {
      try {
        const fh = await open(this.lock_path, "wx");
        await fh.writeFile(`${process.pid}:${Date.now()}`);
        await fh.close();
        return;
      } catch {
        if (Date.now() - start > timeout_ms) throw new Error("decision_lock_timeout");
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  private async release_lock(): Promise<void> {
    try {
      await unlink(this.lock_path);
    } catch {
      // no-op
    }
  }

  private async write_index_atomic(index: DecisionIndexData): Promise<void> {
    const tmp = `${this.index_path}.tmp`;
    await mkdir(dirname(this.index_path), { recursive: true });
    await writeFile(tmp, JSON.stringify(index, null, 2), "utf-8");
    await rename(tmp, this.index_path);
  }

  private async append_records(records: DecisionRecord[]): Promise<void> {
    if (records.length === 0) return;
    await mkdir(dirname(this.store_path), { recursive: true });
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    if (!(await file_exists(this.store_path))) {
      await writeFile(this.store_path, lines, "utf-8");
      return;
    }
    const current = await readFile(this.store_path, "utf-8");
    await writeFile(this.store_path, current + lines, "utf-8");
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
    if (!(await file_exists(this.store_path))) return index;
    const raw = await readFile(this.store_path, "utf-8");
    const lines = raw.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as DecisionRecord;
        if (!record?.id) continue;
        index.records[record.id] = record;
      } catch {
        // skip broken line
      }
    }
    this.rebuild_maps(index);
    index.updated_at = now_iso();
    return index;
  }

  private async load_index(): Promise<DecisionIndexData> {
    if (this.cache) return this.cache;
    await this.ensure_dirs();
    if (!(await file_exists(this.index_path))) {
      this.cache = await this.rebuild_index_from_store();
      await this.write_index_atomic(this.cache);
      return this.cache;
    }
    try {
      const raw = await readFile(this.index_path, "utf-8");
      const parsed = JSON.parse(raw) as DecisionIndexData;
      this.cache = {
        version: Number(parsed.version || INDEX_VERSION),
        records: parsed.records || {},
        active_by_key: parsed.active_by_key || {},
        fingerprints: parsed.fingerprints || {},
        updated_at: parsed.updated_at || now_iso(),
      };
      return this.cache;
    } catch {
      this.cache = await this.rebuild_index_from_store();
      await this.write_index_atomic(this.cache);
      return this.cache;
    }
  }

  async transaction<T>(
    fn: (ctx: {
      index: DecisionIndexData;
      append: (record: DecisionRecord) => void;
      key_ref: (scope: string, scope_id: string | null | undefined, canonical_key: string) => string;
      rebuild_maps: () => void;
    }) => Promise<T>,
  ): Promise<T> {
    await this.acquire_lock();
    try {
      const index = await this.load_index();
      const append_buffer: DecisionRecord[] = [];
      const result = await fn({
        index,
        append: (record) => append_buffer.push(record),
        key_ref,
        rebuild_maps: () => this.rebuild_maps(index),
      });
      index.updated_at = now_iso();
      await this.append_records(append_buffer);
      await this.write_index_atomic(index);
      this.cache = index;
      return result;
    } finally {
      await this.release_lock();
    }
  }

  async list_records(): Promise<DecisionRecord[]> {
    const index = await this.load_index();
    return Object.values(index.records);
  }
}
