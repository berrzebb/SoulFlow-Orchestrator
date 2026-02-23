import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionHistoryEntry, SessionHistoryRange, SessionInfo, SessionMessage, SessionMetadataLine } from "./types.js";
import { ensure_dir, now_iso, safe_filename } from "../utils/common.js";

async function read_lines(path: string): Promise<string[]> {
  const raw = await readFile(path, "utf-8");
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export class Session {
  readonly key: string;
  messages: SessionMessage[];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  last_consolidated: number;

  constructor(args: {
    key: string;
    messages?: SessionMessage[];
    created_at?: string;
    updated_at?: string;
    metadata?: Record<string, unknown>;
    last_consolidated?: number;
  }) {
    this.key = args.key;
    this.messages = args.messages || [];
    this.created_at = args.created_at || now_iso();
    this.updated_at = args.updated_at || this.created_at;
    this.metadata = args.metadata || {};
    this.last_consolidated = Number(args.last_consolidated || 0);
  }

  add_message(role: string, content: string, extra?: Record<string, unknown>): void {
    const message: SessionMessage = {
      role,
      content,
      timestamp: now_iso(),
      ...(extra || {}),
    };
    this.messages.push(message);
    this.updated_at = now_iso();
  }

  get_history(max_messages = 500): SessionHistoryEntry[] {
    const out: SessionHistoryEntry[] = [];
    for (const m of this.messages.slice(-Math.max(1, max_messages))) {
      const entry: SessionHistoryEntry = {
        role: String(m.role || ""),
        content: String(m.content || ""),
      };
      if ("tool_calls" in m) entry.tool_calls = m.tool_calls;
      if (typeof m.tool_call_id === "string") entry.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") entry.name = m.name;
      out.push(entry);
    }
    return out;
  }

  get_history_range(start_offset: number, end_offset: number): SessionHistoryRange {
    const total = this.messages.length;
    const start = Math.max(0, Number(start_offset || 0));
    const end = Math.max(start, Number(end_offset || start));
    const from = Math.max(0, total - end);
    const to = Math.max(from, total - start);
    const slice = this.messages.slice(from, to);
    const items = slice.map((m): SessionHistoryEntry => {
      const out: SessionHistoryEntry = {
        role: String(m.role || ""),
        content: String(m.content || ""),
      };
      if ("tool_calls" in m) out.tool_calls = m.tool_calls;
      if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") out.name = m.name;
      return out;
    });
    return {
      start_offset: start,
      end_offset: end,
      items,
    };
  }

  clear(): void {
    this.messages = [];
    this.last_consolidated = 0;
    this.updated_at = now_iso();
  }
}

export class SessionStore {
  private readonly workspace: string;
  private readonly sessions_dir: string;
  private readonly cache = new Map<string, Session>();
  private readonly initialized: Promise<void>;

  constructor(workspace = process.cwd(), sessions_dir_override?: string) {
    this.workspace = workspace;
    this.sessions_dir = sessions_dir_override || join(this.workspace, "sessions");
    this.initialized = ensure_dir(this.sessions_dir).then(() => undefined);
  }

  private session_path(key: string): string {
    const safe_key = safe_filename(key.replace(/:/g, "_"));
    return join(this.sessions_dir, `${safe_key}.jsonl`);
  }

  async get_or_create(key: string): Promise<Session> {
    await this.initialized;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const loaded = await this.load(key);
    const session = loaded || new Session({ key });
    this.cache.set(key, session);
    return session;
  }

  private async load(key: string): Promise<Session | null> {
    const path = this.session_path(key);
    try {
      await readFile(path, "utf-8");
    } catch {
      return null;
    }

    try {
      const lines = await read_lines(path);
      const messages: SessionMessage[] = [];
      let metadata: Record<string, unknown> = {};
      let created_at = now_iso();
      let updated_at = created_at;
      let last_consolidated = 0;

      for (const line of lines) {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row._type === "metadata") {
          metadata = (row.metadata as Record<string, unknown>) || {};
          if (typeof row.created_at === "string") created_at = row.created_at;
          if (typeof row.updated_at === "string") updated_at = row.updated_at;
          last_consolidated = Number(row.last_consolidated || 0);
          continue;
        }
        messages.push(row as SessionMessage);
      }

      return new Session({
        key,
        messages,
        created_at,
        updated_at,
        metadata,
        last_consolidated,
      });
    } catch {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await this.initialized;
    const path = this.session_path(session.key);
    const metadata_line: SessionMetadataLine = {
      _type: "metadata",
      key: session.key,
      created_at: session.created_at,
      updated_at: session.updated_at,
      metadata: session.metadata,
      last_consolidated: session.last_consolidated,
    };
    const lines = [JSON.stringify(metadata_line), ...session.messages.map((m) => JSON.stringify(m))];
    await writeFile(path, `${lines.join("\n")}\n`, "utf-8");
    this.cache.set(session.key, session);
  }

  async save_session(session: Session): Promise<void> {
    await this.save(session);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidate_session(key: string): void {
    this.invalidate(key);
  }

  async list_sessions(): Promise<SessionInfo[]> {
    await this.initialized;
    const files = (await readdir(this.sessions_dir)).filter((f) => f.endsWith(".jsonl"));
    const out: SessionInfo[] = [];
    for (const name of files) {
      const path = join(this.sessions_dir, name);
      try {
        const lines = await read_lines(path);
        if (lines.length === 0) continue;
        const first = JSON.parse(lines[0]) as Record<string, unknown>;
        if (first._type !== "metadata") continue;
        const key = typeof first.key === "string" ? first.key : name.replace(/\.jsonl$/i, "").replace("_", ":");
        out.push({
          key,
          created_at: typeof first.created_at === "string" ? first.created_at : undefined,
          updated_at: typeof first.updated_at === "string" ? first.updated_at : undefined,
          path,
        });
      } catch {
        // skip broken session files
      }
    }
    return out.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  }

  async get_history_range(key: string, start_offset: number, end_offset: number): Promise<SessionHistoryRange> {
    const session = await this.get_or_create(key);
    return session.get_history_range(start_offset, end_offset);
  }
}
