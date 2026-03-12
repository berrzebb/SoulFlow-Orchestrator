/**
 * migrate-standalone.mjs — 컨테이너 프로덕션 환경용 마이그레이션 스크립트.
 *
 * TypeScript/tsx 없이 Node.js + better-sqlite3 만으로 실행.
 * AdminStore 동일 스키마를 직접 생성하고 superadmin 계정을 초기화한다.
 *
 * 사용법 (컨테이너 내부):
 *   node /app/scripts/migrate-standalone.mjs \
 *     --workspace /data \
 *     --admin-user admin \
 *     --admin-password <password>
 */

import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

// ── CLI 파싱 ──

function parse_args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      result[key] = val;
    }
  }
  return result;
}

const args = parse_args(process.argv.slice(2));
const workspace_root = args["workspace"] ? resolve(args["workspace"]) : "/data";
const admin_user = args["admin-user"] ?? "admin";
const admin_password = args["admin-password"];

if (!admin_password) {
  console.error("오류: --admin-password 가 필요합니다.");
  process.exit(1);
}
if (admin_password.length < 6) {
  console.error("오류: --admin-password 는 6자 이상이어야 합니다.");
  process.exit(1);
}

console.log(`\n워크스페이스 마이그레이션 시작`);
console.log(`  Root    : ${workspace_root}`);
console.log(`  Admin   : ${admin_user}\n`);

// ── 경로 계산 ──

const admin_dir = join(workspace_root, "admin");
const admin_db_path = join(admin_dir, "admin.db");
const admin_vault_dir = join(admin_dir, "security");

// ── 디렉토리 생성 ──

for (const dir of [admin_dir, admin_vault_dir]) {
  mkdirSync(dir, { recursive: true });
  console.log(`  mkdir ${dir}`);
}

// ── 비밀번호 해싱 (scrypt, AuthService와 동일 포맷) ──
// AuthService: N=16384, r=8, p=1, keyLen=64 (Node.js scryptSync 기본값과 동일)

function hash_password(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `${salt}:${hash}`;
}

// ── AdminStore 스키마 + superadmin 생성 ──

const admin_db = new Database(admin_db_path);
admin_db.pragma("journal_mode = WAL");

admin_db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    system_role  TEXT NOT NULL DEFAULT 'user',
    default_team_id TEXT,
    last_login_at TEXT,
    disabled_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS shared_providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL DEFAULT '{}',
    api_key_ref TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const is_initialized = admin_db.prepare(
  `SELECT 1 FROM users WHERE system_role = 'superadmin' LIMIT 1`
).get();

if (is_initialized) {
  console.log(`\nadmin.db 이미 초기화됨 → superadmin 생성 건너뜀`);
} else {
  // JWT 시크릿 저장
  const jwt_secret = randomBytes(48).toString("base64url");
  admin_db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)`).run(jwt_secret);

  const admin_user_id = randomUUID();
  const password_hash = hash_password(admin_password);

  admin_db.prepare(`
    INSERT INTO users (id, username, password_hash, system_role)
    VALUES (?, ?, ?, 'superadmin')
  `).run(admin_user_id, admin_user, password_hash);

  console.log(`\nsuperadmin 생성 완료`);
  console.log(`  user_id : ${admin_user_id}`);
  console.log(`  username: ${admin_user}`);
}

admin_db.close();

// ── 마이그레이션 상태 저장 ──

const migration_state_path = join(workspace_root, ".migration-state.json");
const state = {
  version: 2,
  migrated_at: new Date().toISOString(),
  workspace_root,
  admin_db: admin_db_path,
  note: "admin.db 생성/초기화 완료.",
};
writeFileSync(migration_state_path, JSON.stringify(state, null, 2));
console.log(`\n마이그레이션 상태 저장: ${migration_state_path}`);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 마이그레이션 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 생성된 구조:
   ${workspace_root}/
   ├── admin/
   │   ├── admin.db   ← superadmin + JWT 시크릿
   │   └── security/
   └── .migration-state.json

 다음: 컨테이너 재시작 → /data/admin/admin.db 자동 감지 → 인증 활성화
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
