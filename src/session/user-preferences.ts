/** 사용자별 환경설정 — SQLite 기반 key-value 저장. */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type UserPreferences = {
  language?: string;
  preferred_provider?: string;
  response_style?: "concise" | "detailed" | "default";
  timezone?: string;
};

const EMPTY_PREFS: UserPreferences = {};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY NOT NULL,
    preferences TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export class UserPreferenceStore {
  private db: Database.Database | null = null;
  private readonly db_path: string;

  constructor(db_path: string) {
    this.db_path = db_path;
  }

  private get_db(): Database.Database {
    if (!this.db) throw new Error("UserPreferenceStore not initialized");
    return this.db;
  }

  async ensure_ready(): Promise<void> {
    if (this.db) return;
    await mkdir(dirname(this.db_path), { recursive: true });
    this.db = new Database(this.db_path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  async get(user_id: string): Promise<UserPreferences> {
    await this.ensure_ready();
    const row = this.get_db().prepare("SELECT preferences FROM user_preferences WHERE user_id = ?").get(user_id) as { preferences: string } | undefined;
    if (!row) return { ...EMPTY_PREFS };
    try {
      return JSON.parse(row.preferences) as UserPreferences;
    } catch {
      return { ...EMPTY_PREFS };
    }
  }

  async set(user_id: string, prefs: Partial<UserPreferences>): Promise<void> {
    await this.ensure_ready();
    const existing = await this.get(user_id);
    const merged = { ...existing, ...prefs };
    // undefined 값 제거
    for (const key of Object.keys(merged) as Array<keyof UserPreferences>) {
      if (merged[key] === undefined) delete merged[key];
    }
    const now = new Date().toISOString();
    this.get_db().prepare(`
      INSERT INTO user_preferences (user_id, preferences, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET preferences = ?, updated_at = ?
    `).run(user_id, JSON.stringify(merged), now, now, JSON.stringify(merged), now);
  }

  async delete(user_id: string): Promise<void> {
    await this.ensure_ready();
    this.get_db().prepare("DELETE FROM user_preferences WHERE user_id = ?").run(user_id);
  }

  async list_all(): Promise<Array<{ user_id: string; preferences: UserPreferences }>> {
    await this.ensure_ready();
    const rows = this.get_db().prepare("SELECT user_id, preferences FROM user_preferences ORDER BY updated_at DESC").all() as Array<{ user_id: string; preferences: string }>;
    return rows.map((r) => {
      let prefs: UserPreferences;
      try {
        prefs = JSON.parse(r.preferences) as UserPreferences;
      } catch {
        prefs = { ...EMPTY_PREFS };
      }
      return { user_id: r.user_id, preferences: prefs };
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
