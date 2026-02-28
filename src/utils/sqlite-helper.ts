/** 공유 SQLite 유틸리티 — open-per-call 패턴. */

import Database from "better-sqlite3";

type DatabaseSync = Database.Database;
export type { DatabaseSync };

export type SqliteRunOptions = {
  /** 연결 후 실행할 PRAGMA 목록 (예: ["foreign_keys=ON"]) */
  pragmas?: string[];
};

/** DB를 열고 콜백 실행 후 닫는다. 에러 시 null. */
export function with_sqlite<T>(
  db_path: string,
  run: (db: DatabaseSync) => T,
  options?: SqliteRunOptions,
): T | null {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(db_path);
    if (options?.pragmas) {
      for (const p of options.pragmas) db.pragma(p);
    }
    return run(db);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* no-op */ }
  }
}

/** DB를 열고 콜백 실행 후 닫는다. 에러 시 throw (secret-vault 등 strict 용도). */
export function with_sqlite_strict<T>(
  db_path: string,
  run: (db: DatabaseSync) => T,
  options?: SqliteRunOptions,
): T {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(db_path);
    if (options?.pragmas) {
      for (const p of options.pragmas) db.pragma(p);
    }
    return run(db);
  } finally {
    try { db?.close(); } catch { /* no-op */ }
  }
}
