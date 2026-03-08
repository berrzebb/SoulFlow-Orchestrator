/**
 * SkillIndex — FTS5 기반 4차원 스킬 매처.
 * AgentDomain.recommend_skills() 구현을 교체.
 * 인메모리 SQLite DB를 사용. 전역 singleton 금지 (주입형).
 */

import { with_sqlite } from "../utils/sqlite-helper.js";
import type { SkillMetadata } from "../agent/skills.types.js";
import { extract_intents, extract_file_extensions, extract_code_hints } from "./intent-patterns.js";

export interface SkillIndexEntry {
  name: string;
  triggers: string;
  aliases: string;
  summary: string;
  intents: string;
  file_pats: string;
  code_pats: string;
}

export interface SkillSelectOptions {
  /** 파일 확장자 힌트. 없으면 task 텍스트에서 자동 추출. */
  file_hints?: string[];
  /** 코드 키워드 힌트. 없으면 task 텍스트에서 자동 추출. */
  code_hints?: string[];
}

export class SkillIndex {
  /** ":memory:" — 인메모리 DB. 스킬 목록이 변경되면 rebuild() 호출. */
  private readonly db_path = ":memory:";
  private built = false;

  /** SQLite DB 핸들. 인메모리이므로 with_sqlite를 인스턴스로 유지. */
  private readonly db: import("better-sqlite3").Database;

  constructor() {
    const Database = require("better-sqlite3");
    this.db = new Database(this.db_path);
    this._init_schema();
  }

  private _init_schema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_docs (
        rowid  INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        triggers   TEXT NOT NULL DEFAULT '',
        aliases    TEXT NOT NULL DEFAULT '',
        summary    TEXT NOT NULL DEFAULT '',
        intents    TEXT NOT NULL DEFAULT '',
        file_pats  TEXT NOT NULL DEFAULT '',
        code_pats  TEXT NOT NULL DEFAULT ''
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
        name, triggers, aliases, summary, intents, file_pats, code_pats,
        content='skill_docs', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
  }

  /** 스킬 목록으로 인덱스 재구축. */
  build(skills: SkillMetadata[]): void {
    this.db.exec("DELETE FROM skill_docs; DELETE FROM skills_fts;");

    const insert = this.db.prepare(`
      INSERT INTO skill_docs (name, triggers, aliases, summary, intents, file_pats, code_pats)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const fts_insert = this.db.prepare(`
      INSERT INTO skills_fts (rowid, name, triggers, aliases, summary, intents, file_pats, code_pats)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const s of skills) {
        if (s.type === "role") continue;
        const info = insert.run(
          s.name,
          s.triggers.join(" "),
          s.aliases.join(" "),
          s.summary,
          s.intents.join(" "),
          s.file_patterns.join(" "),
          s.code_patterns.join(" "),
        );
        fts_insert.run(info.lastInsertRowid, s.name, s.triggers.join(" "), s.aliases.join(" "), s.summary, s.intents.join(" "), s.file_patterns.join(" "), s.code_patterns.join(" "));
      }
    });
    tx();
    this.built = true;
  }

  /** 4차원 스코어링으로 스킬 선택. */
  select(task: string, options: SkillSelectOptions = {}, limit = 6): string[] {
    if (!this.built) return [];
    const max = Math.max(1, Math.min(20, limit));

    // 추출된 힌트
    const intents = extract_intents(task);
    const file_hints = options.file_hints ?? extract_file_extensions(task);
    const code_hints = options.code_hints ?? extract_code_hints(task);

    // FTS5 BM25 기반 키워드 매칭
    const fts_query = task.trim().replace(/["']/g, " ").slice(0, 200);
    const scored = new Map<string, number>();

    if (fts_query.length >= 2) {
      try {
        const rows = this.db.prepare(`
          SELECT sd.name, bm25(skills_fts) AS score
          FROM skills_fts sf
          JOIN skill_docs sd ON sd.rowid = sf.rowid
          WHERE skills_fts MATCH ?
          ORDER BY score
          LIMIT 50
        `).all(fts_query) as Array<{ name: string; score: number }>;

        for (const row of rows) {
          // BM25는 음수값 (낮을수록 좋음), 양수로 변환
          scored.set(row.name, (scored.get(row.name) ?? 0) + Math.abs(row.score) * 2);
        }
      } catch {
        // FTS5 쿼리 파싱 오류 무시
      }
    }

    // Intent 보너스 (+3/match)
    if (intents.length > 0) {
      const rows = this.db.prepare(
        `SELECT name, intents FROM skill_docs WHERE intents != ''`
      ).all() as Array<{ name: string; intents: string }>;

      for (const row of rows) {
        const row_intents = row.intents.split(/\s+/);
        const hits = intents.filter((i) => row_intents.includes(i)).length;
        if (hits > 0) scored.set(row.name, (scored.get(row.name) ?? 0) + hits * 3);
      }
    }

    // File pattern 보너스 (+4/match)
    if (file_hints.length > 0) {
      const rows = this.db.prepare(
        `SELECT name, file_pats FROM skill_docs WHERE file_pats != ''`
      ).all() as Array<{ name: string; file_pats: string }>;

      for (const row of rows) {
        const pats = row.file_pats.toLowerCase().split(/\s+/);
        const hits = file_hints.filter((h) => pats.some((p) => p.includes(h.replace("*.", ".")) || h.includes(p.replace("*.", ".")))).length;
        if (hits > 0) scored.set(row.name, (scored.get(row.name) ?? 0) + hits * 4);
      }
    }

    // Code pattern 보너스 (+3/match)
    if (code_hints.length > 0) {
      const rows = this.db.prepare(
        `SELECT name, code_pats FROM skill_docs WHERE code_pats != ''`
      ).all() as Array<{ name: string; code_pats: string }>;

      for (const row of rows) {
        const pats = row.code_pats.toLowerCase().split(/\s+/);
        const hits = code_hints.filter((h) => pats.includes(h.toLowerCase())).length;
        if (hits > 0) scored.set(row.name, (scored.get(row.name) ?? 0) + hits * 3);
      }
    }

    return [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([name]) => name);
  }

  get is_built(): boolean {
    return this.built;
  }

  /** DB 연결 정리. */
  close(): void {
    try { this.db.close(); } catch { /* noop */ }
  }
}
