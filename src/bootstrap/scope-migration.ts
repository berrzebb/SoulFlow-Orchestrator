/**
 * 글로벌/유저 스코프 마이그레이션.
 * user_dir/runtime/ 에 있던 글로벌 리소스(config, providers, security, definitions)를
 * workspace/runtime/ 으로 한 번만 복사한다. 이미 글로벌에 유효한 데이터가 있으면 건드리지 않는다.
 */

import { existsSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { with_sqlite } from "../utils/sqlite-helper.js";

/** 단일 SQLite DB 파일(+ WAL/SHM) 복사. */
function copy_sqlite(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  for (const ext of ["-wal", "-shm"]) {
    if (existsSync(from + ext)) copyFileSync(from + ext, to + ext);
  }
}

/** 특정 테이블의 행 수를 반환. 실패 시 -1. */
function count_rows(db_path: string, table: string): number {
  return with_sqlite(db_path, (db) => {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    return row.cnt;
  }) ?? -1;
}

interface MigrateDbOpts {
  from: string;
  to: string;
  table: string;
}

/** 글로벌 DB가 비어있고 유저 DB에 데이터가 있으면 복사. */
function migrate_db(opts: MigrateDbOpts): void {
  const { from, to, table } = opts;
  if (!existsSync(from)) return;

  if (!existsSync(to)) {
    copy_sqlite(from, to);
    return;
  }

  // 글로벌이 비어있고 유저에 데이터가 있으면 덮어쓰기
  const global_count = count_rows(to, table);
  if (global_count > 0) return;

  const user_count = count_rows(from, table);
  if (user_count > 0) copy_sqlite(from, to);
}

/** security 디렉토리 전체 복사 (keyring.db, secrets.db 등). */
function migrate_security_dir(from_dir: string, to_dir: string): void {
  if (!existsSync(from_dir)) return;
  if (existsSync(to_dir)) return; // 이미 존재하면 건드리지 않음
  mkdirSync(to_dir, { recursive: true });
  for (const file of readdirSync(from_dir)) {
    copyFileSync(join(from_dir, file), join(to_dir, file));
  }
}

/**
 * 3-tier 스코프 마이그레이션.
 *
 * 1) user → global: config, security, providers, definitions
 * 2) user → team: channels, oauth, cron, dlq, datasources
 *
 * 동일 경로면 (single-user 모드) no-op.
 */
export function migrate_to_global_scope(workspace: string, user_dir: string, team_dir?: string): void {
  if (resolve(workspace) === resolve(user_dir)) return;

  const global_rt = join(workspace, "runtime");
  const user_rt = join(user_dir, "runtime");

  // ── user → global ──

  // 1) security vault (keyring, secrets) — 가장 먼저 (providers 복호화에 필요)
  migrate_security_dir(join(user_rt, "security"), join(global_rt, "security"));

  // 2) config
  migrate_db({ from: join(user_rt, "config", "config.db"), to: join(global_rt, "config", "config.db"), table: "config_overrides" });

  // 3) agent providers
  migrate_db({ from: join(user_rt, "agent-providers", "providers.db"), to: join(global_rt, "agent-providers", "providers.db"), table: "agent_providers" });

  // 4) agent definitions
  migrate_db({ from: join(user_rt, "agent-definitions", "definitions.db"), to: join(global_rt, "agent-definitions", "definitions.db"), table: "agent_definitions" });

  // ── user → team (team_dir이 user_dir과 다를 때만) ──

  const effective_team_dir = team_dir || user_dir;
  if (resolve(effective_team_dir) === resolve(user_dir)) return;
  const team_rt = join(effective_team_dir, "runtime");

  // 5) channels
  migrate_db({ from: join(user_rt, "channels", "instances.db"), to: join(team_rt, "channels", "instances.db"), table: "channel_instances" });

  // 6) oauth integrations
  migrate_db({ from: join(user_rt, "oauth", "integrations.db"), to: join(team_rt, "oauth", "integrations.db"), table: "oauth_integrations" });

  // 7) cron
  if (existsSync(join(user_rt, "cron", "cron.db")) && !existsSync(join(team_rt, "cron", "cron.db"))) {
    copy_sqlite(join(user_rt, "cron", "cron.db"), join(team_rt, "cron", "cron.db"));
  }

  // 8) dlq
  if (existsSync(join(user_rt, "dlq", "dlq.db")) && !existsSync(join(team_rt, "dlq", "dlq.db"))) {
    copy_sqlite(join(user_rt, "dlq", "dlq.db"), join(team_rt, "dlq", "dlq.db"));
  }

  // 9) datasources
  migrate_dir_if_missing(join(user_rt, "datasources"), join(team_rt, "datasources"));
}

/** 디렉토리 전체를 대상에 없으면 복사. */
function migrate_dir_if_missing(from_dir: string, to_dir: string): void {
  if (!existsSync(from_dir)) return;
  if (existsSync(to_dir)) return;
  mkdirSync(to_dir, { recursive: true });
  for (const file of readdirSync(from_dir)) {
    const src = join(from_dir, file);
    copyFileSync(src, join(to_dir, file));
  }
}
