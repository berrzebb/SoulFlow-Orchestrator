import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  ConsolidationMessage,
  ConsolidationSession,
  LlmProviderLike,
  MemoryConsolidateOptions,
  MemoryConsolidateResult,
  MemoryKind,
  MemoryStoreLike,
} from "./memory.types.js";
import { today_key } from "../utils/common.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { SecretVaultService } from "../security/secret-vault.js";
import { parse_tool_calls_from_text } from "./tool-call-parser.js";

type DatabaseSync = Database.Database;

const SAVE_MEMORY_TOOL = [
  {
    name: "save_memory",
    description: "Persist consolidated history and long-term memory update.",
    input_schema: {
      type: "object",
      properties: {
        history_entry: { type: "string", description: "Append-only history summary entry" },
        memory_update: { type: "string", description: "Full replacement content for long-term memory stored in memory.db" },
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

export class MemoryStore implements MemoryStoreLike {
  private readonly root: string;
  private readonly memory_dir: string;
  private readonly sqlite_path: string;
  private readonly initialized: Promise<void>;

  constructor(workspace_root = process.cwd()) {
    this.root = workspace_root;
    this.memory_dir = join(this.root, "memory");
    this.sqlite_path = join(this.memory_dir, "memory.db");
    this.initialized = this.ensure_initialized();
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.memory_dir, { recursive: true });
    this.with_sqlite((db) => {
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
      return true;
    });
    this.ensure_longterm_document();
  }

  private with_sqlite<T>(run: (db: DatabaseSync) => T): T | null {
    let db: DatabaseSync | null = null;
    try {
      db = new Database(this.sqlite_path);
      return run(db);
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {
        // no-op
      }
    }
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
    const row = this.with_sqlite((db) => db.prepare(`
      SELECT doc_key
      FROM memory_documents
      WHERE doc_key = ?
      LIMIT 1
    `).get(this.longterm_doc_key()) as { doc_key: string } | undefined) || undefined;
    if (row) return;
    this.sqlite_upsert_document("longterm", "__longterm__", this.longterm_uri(), "");
  }

  private sqlite_upsert_document(kind: "longterm" | "daily", day: string, path: string, content: string): void {
    this.with_sqlite((db) => {
      db.prepare(`
        INSERT INTO memory_documents (doc_key, kind, day, path, content, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_key) DO UPDATE SET
          kind = excluded.kind,
          day = excluded.day,
          path = excluded.path,
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(
        kind === "longterm" ? this.longterm_doc_key() : this.daily_doc_key(day),
        kind,
        day,
        path,
        String(content || ""),
        new Date().toISOString(),
      );
      return true;
    });
  }

  private sqlite_read_document(kind: "longterm" | "daily", day: string): MemoryDocRow | null {
    const doc_key = kind === "longterm" ? this.longterm_doc_key() : this.daily_doc_key(day);
    const row = this.with_sqlite((db) => db.prepare(`
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
    const removed = this.with_sqlite((db) => {
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
    const rows = this.with_sqlite((db) => db.prepare(`
      SELECT day
      FROM memory_documents
      WHERE kind = 'daily'
      ORDER BY day ASC
    `).all() as Array<{ day: string }>) || [];
    return rows
      .map((row) => String(row.day || ""))
      .filter((day) => is_day_key(day))
      .map((day) => `${day}.md`);
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
    const prev = await this.read_longterm();
    this.sqlite_upsert_document("longterm", "__longterm__", this.longterm_uri(), `${prev}${String(content || "")}`);
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
    const prev = await this.read_daily(day_key);
    this.sqlite_upsert_document("daily", day_key, this.daily_uri(day_key), `${prev}${String(content || "")}`);
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
    const limit = Math.max(1, Number(args?.limit || 80));
    const case_sensitive = !!args?.case_sensitive;
    const raw_query = String(query || "").trim();
    if (!raw_query) return [];
    const fts_query = this.build_fts_query(raw_query);
    if (!fts_query) return [];

    const kind = args?.kind || "all";
    const day = String(args?.day || "").trim();
    const where: string[] = ["memory_documents_fts MATCH ?"];
    const bind: Array<string | number> = [fts_query];
    if (kind === "longterm") {
      where.push("d.kind = ?");
      bind.push("longterm");
    } else if (kind === "daily") {
      where.push("d.kind = ?");
      bind.push("daily");
      if (is_day_key(day)) {
        where.push("d.day = ?");
        bind.push(day);
      }
    } else if (is_day_key(day)) {
      where.push("d.day = ?");
      bind.push(day);
    }
    bind.push(Math.max(limit * 6, 24));

    const docs = this.with_sqlite((db) => db.prepare(`
      SELECT d.path AS path, d.content AS content
      FROM memory_documents_fts f
      JOIN memory_documents d ON d.rowid = f.rowid
      WHERE ${where.join(" AND ")}
      ORDER BY bm25(memory_documents_fts), d.updated_at DESC
      LIMIT ?
    `).all(...bind) as MemoryDocRow[]) || [];

    const needle = case_sensitive ? raw_query : raw_query.toLowerCase();
    const out: Array<{ file: string; line: number; text: string }> = [];
    for (const doc of docs) {
      const lines = String(doc.content || "").split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const text = String(lines[i] || "");
        const hay = case_sensitive ? text : text.toLowerCase();
        if (!hay.includes(needle)) continue;
        out.push({ file: String(doc.path || ""), line: i + 1, text });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async consolidate(options?: MemoryConsolidateOptions): Promise<MemoryConsolidateResult> {
    await this.initialized;
    const window_days = Math.max(1, Math.min(365, Number(options?.memory_window || 7)));
    const now = new Date();
    const files = await this.list_daily();
    const used: string[] = [];
    const archived: string[] = [];
    const chunks: string[] = [];

    for (const file of files) {
      const day = String(file || "").slice(0, 10);
      if (!is_day_key(day)) continue;
      const d = new Date(`${day}T00:00:00Z`);
      if (!Number.isFinite(d.getTime())) continue;
      const age = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (age > window_days) continue;
      const content = (await this.read_daily(day)).trim();
      if (!content) continue;
      used.push(`${day}.md`);
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
      for (const file of used) {
        const day = file.slice(0, 10);
        if (!is_day_key(day)) continue;
        if (!this.sqlite_delete_daily(day)) continue;
        archived.push(`sqlite://memory/archive/daily/${day}`);
      }
    }

    return {
      ok: true,
      longterm_appended_chars: block.length,
      daily_files_used: used,
      archived_files: archived,
      summary: body ? `consolidated ${used.length} daily files` : "no daily files consolidated",
      compressed_prompt,
    };
  }

  async consolidate_with_provider(
    session: ConsolidationSession,
    provider: LlmProviderLike,
    model: string,
    options?: { archive_all?: boolean; memory_window?: number },
  ): Promise<boolean> {
    const secret_vault = new SecretVaultService(this.root);
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
      const text = typeof history_entry === "string" ? history_entry : JSON.stringify(history_entry);
      if (text.trim()) await this.append_daily(`${text}\n`);
    }

    const memory_update = args.memory_update;
    if (memory_update !== undefined && memory_update !== null) {
      const text = typeof memory_update === "string" ? memory_update : JSON.stringify(memory_update);
      if (text !== current_memory) await this.write_longterm(text);
    }

    session.last_consolidated = archive_all ? 0 : Math.max(0, session.messages.length - keep_count);
    return true;
  }
}
