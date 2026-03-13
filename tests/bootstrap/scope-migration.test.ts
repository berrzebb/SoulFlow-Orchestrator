import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { migrate_to_global_scope } from "../../src/bootstrap/scope-migration.js";

/** 테스트용 임시 디렉토리 생성. */
function make_tmp(): string {
  const dir = join(tmpdir(), `scope-mig-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** SQLite DB에 테이블 + 행 삽입. */
function seed_db(path: string, table: string, columns: string, values: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${columns})`);
  db.exec(`INSERT INTO ${table} VALUES (${values})`);
  db.close();
}

/** 테이블 행 수 반환. */
function count(path: string, table: string): number {
  if (!existsSync(path)) return 0;
  const db = new Database(path);
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
  db.close();
  return row.cnt;
}

describe("migrate_to_global_scope", () => {
  let root: string;

  beforeEach(() => { root = make_tmp(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("single-user mode (workspace === user_dir) — no-op", () => {
    const ws_rt = join(root, "runtime");
    seed_db(join(ws_rt, "channels", "instances.db"), "channel_instances", "id TEXT", "'ch1'");
    migrate_to_global_scope(root, root);
    // 데이터가 그대로 남아있어야 함
    expect(count(join(ws_rt, "channels", "instances.db"), "channel_instances")).toBe(1);
  });

  describe("workspace → team (단일 유저 레거시 마이그레이션)", () => {
    let team_dir: string;
    let user_dir: string;

    beforeEach(() => {
      team_dir = join(root, "tenants", "default");
      user_dir = join(team_dir, "users", "u1");
      mkdirSync(user_dir, { recursive: true });
    });

    it("channels: workspace/runtime/ → team/runtime/", () => {
      seed_db(join(root, "runtime", "channels", "instances.db"), "channel_instances", "id TEXT, provider TEXT", "'ch1', 'slack'");

      migrate_to_global_scope(root, user_dir, team_dir);

      const team_db = join(team_dir, "runtime", "channels", "instances.db");
      expect(existsSync(team_db)).toBe(true);
      expect(count(team_db, "channel_instances")).toBe(1);
    });

    it("oauth: workspace/runtime/ → team/runtime/", () => {
      seed_db(join(root, "runtime", "oauth", "integrations.db"), "oauth_integrations", "id TEXT", "'oauth1'");

      migrate_to_global_scope(root, user_dir, team_dir);

      expect(count(join(team_dir, "runtime", "oauth", "integrations.db"), "oauth_integrations")).toBe(1);
    });

    it("cron: workspace/runtime/ → team/runtime/", () => {
      seed_db(join(root, "runtime", "cron", "cron.db"), "cron_jobs", "id TEXT", "'j1'");

      migrate_to_global_scope(root, user_dir, team_dir);

      expect(count(join(team_dir, "runtime", "cron", "cron.db"), "cron_jobs")).toBe(1);
    });

    it("dlq: workspace/runtime/ → team/runtime/", () => {
      seed_db(join(root, "runtime", "dlq", "dlq.db"), "dlq_entries", "id TEXT", "'d1'");

      migrate_to_global_scope(root, user_dir, team_dir);

      expect(existsSync(join(team_dir, "runtime", "dlq", "dlq.db"))).toBe(true);
    });

    it("team 대상에 이미 데이터가 있으면 건너뜀", () => {
      // workspace에 1행
      seed_db(join(root, "runtime", "channels", "instances.db"), "channel_instances", "id TEXT", "'old'");
      // team에 이미 2행
      const team_db = join(team_dir, "runtime", "channels", "instances.db");
      seed_db(team_db, "channel_instances", "id TEXT", "'new1'");
      const db = new Database(team_db);
      db.exec("INSERT INTO channel_instances VALUES ('new2')");
      db.close();

      migrate_to_global_scope(root, user_dir, team_dir);

      // team 데이터 유지 (덮어쓰지 않음)
      expect(count(team_db, "channel_instances")).toBe(2);
    });
  });

  describe("workspace → user (세션/결정/이벤트 마이그레이션)", () => {
    let user_dir: string;

    beforeEach(() => {
      user_dir = join(root, "tenants", "default", "users", "u1");
      mkdirSync(user_dir, { recursive: true });
    });

    it("sessions: workspace/runtime/ → user/runtime/", () => {
      seed_db(join(root, "runtime", "sessions", "sessions.db"), "session_messages", "id INTEGER, content TEXT", "1, 'hello'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      const user_db = join(user_dir, "runtime", "sessions", "sessions.db");
      expect(existsSync(user_db)).toBe(true);
      expect(count(user_db, "session_messages")).toBe(1);
    });

    it("decisions: workspace/runtime/ → user/runtime/", () => {
      seed_db(join(root, "runtime", "decisions", "decisions.db"), "decisions", "id TEXT", "'dec1'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      expect(count(join(user_dir, "runtime", "decisions", "decisions.db"), "decisions")).toBe(1);
    });

    it("events: workspace/runtime/ → user/runtime/", () => {
      seed_db(join(root, "runtime", "events", "events.db"), "workflow_events", "id TEXT", "'ev1'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      expect(count(join(user_dir, "runtime", "events", "events.db"), "workflow_events")).toBe(1);
    });

    it("user 대상에 이미 데이터가 있으면 건너뜀", () => {
      seed_db(join(root, "runtime", "sessions", "sessions.db"), "session_messages", "id INTEGER, content TEXT", "1, 'old'");
      const user_db = join(user_dir, "runtime", "sessions", "sessions.db");
      seed_db(user_db, "session_messages", "id INTEGER, content TEXT", "2, 'new'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      // user 데이터 유지
      expect(count(user_db, "session_messages")).toBe(1);
    });
  });

  describe("user → global (기존 경로)", () => {
    let user_dir: string;

    beforeEach(() => {
      user_dir = join(root, "tenants", "default", "users", "u1");
      mkdirSync(user_dir, { recursive: true });
    });

    it("config: user/runtime/ → workspace/runtime/", () => {
      seed_db(join(user_dir, "runtime", "config", "config.db"), "config_overrides", "key TEXT, value TEXT", "'k1', 'v1'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      expect(count(join(root, "runtime", "config", "config.db"), "config_overrides")).toBe(1);
    });

    it("providers: user/runtime/ → workspace/runtime/", () => {
      seed_db(join(user_dir, "runtime", "agent-providers", "providers.db"), "agent_providers", "id TEXT", "'p1'");

      migrate_to_global_scope(root, user_dir, join(root, "tenants", "default"));

      expect(count(join(root, "runtime", "agent-providers", "providers.db"), "agent_providers")).toBe(1);
    });
  });
});
