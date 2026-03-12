/**
 * migrate-workspace.ts — 단일 사용자 워크스페이스를 멀티테넌트 구조로 마이그레이션.
 *
 * Phase 1 (비파괴적): admin.db + team.db 생성 및 초기 superadmin/team 설정.
 * 기존 runtime/ 파일은 이동하지 않음 — bootstrap 연동 후 Phase 2에서 이동.
 *
 * 사용법:
 *   npx tsx scripts/migrate-workspace.ts \
 *     --workspace D:\soulflow\workspace \
 *     --admin-user admin \
 *     --admin-password <password> \
 *     --team-slug default \
 *     --team-name "Default Team"
 */

import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { AdminStore } from "../src/auth/admin-store.js";
import { AuthService } from "../src/auth/auth-service.js";
import { TeamStore } from "../src/auth/team-store.js";

// 경로 해석
const project_root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

// CLI 인수 파싱
function parse_args(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
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

const workspace_root = args["workspace"] ? resolve(args["workspace"]) : resolve(project_root, "workspace");
const admin_user = args["admin-user"] ?? "admin";
const admin_password = args["admin-password"];
const team_slug = args["team-slug"] ?? "default";
const team_name = args["team-name"] ?? "Default Team";

if (!admin_password) {
  console.error("오류: --admin-password 가 필요합니다.");
  process.exit(1);
}

console.log(`\n워크스페이스 마이그레이션 시작`);
console.log(`  Root    : ${workspace_root}`);
console.log(`  Admin   : ${admin_user}`);
console.log(`  Team    : ${team_slug} (${team_name})\n`);

// ── 경로 계산 ──

const admin_dir = join(workspace_root, "admin");
const admin_db_path = join(admin_dir, "admin.db");
const admin_vault_dir = join(admin_dir, "security");

const team_dir = join(workspace_root, "tenants", team_slug);
const team_db_path = join(team_dir, "team.db");
const team_shared_dir = join(team_dir, "shared");
const team_users_dir = join(team_dir, "users");

// ── 디렉토리 생성 ──

for (const dir of [admin_dir, admin_vault_dir, team_dir, team_shared_dir, team_users_dir]) {
  mkdirSync(dir, { recursive: true });
  console.log(`  mkdir ${dir}`);
}

// ── AdminStore 초기화 ──

const admin_store = new AdminStore(admin_db_path);
const auth_svc = new AuthService(admin_store);

if (admin_store.is_initialized()) {
  console.log(`\nadmin.db 이미 초기화됨 → superadmin 생성 건너뜀`);
} else {
  const password_hash = auth_svc.hash_password(admin_password);
  const admin_record = admin_store.create_user({
    username: admin_user,
    password_hash,
    system_role: "superadmin",
  });
  console.log(`\nsuperadmin 생성 완료`);
  console.log(`  user_id : ${admin_record.id}`);
  console.log(`  username: ${admin_record.username}`);
}

// ── TeamStore 초기화 ──

const team_store = new TeamStore(team_db_path);

const existing_team = team_store.get_team_by_slug(team_slug);
if (existing_team) {
  console.log(`\nteam.db 이미 존재 → 팀 생성 건너뜀 (id: ${existing_team.id})`);
} else {
  const team = team_store.create_team({ slug: team_slug, name: team_name });
  console.log(`\n팀 생성 완료`);
  console.log(`  team_id : ${team.id}`);
  console.log(`  slug    : ${team.slug}`);
  console.log(`  name    : ${team.name}`);

  // superadmin을 팀 owner로 등록
  const admin_record = admin_store.get_user_by_username(admin_user)!;
  team_store.add_member({ team_id: team.id, user_id: admin_record.id, role: "owner" });
  console.log(`  owner   : ${admin_record.username} (${admin_record.id})`);

  // superadmin의 default_team_id 설정
  admin_store.update_user(admin_record.id, { default_team_id: team.id });

  // 개인 workspace 디렉토리 생성
  const user_ws_dir = join(team_users_dir, admin_record.id);
  mkdirSync(user_ws_dir, { recursive: true });
  console.log(`  user workspace: ${user_ws_dir}`);
}

// ── 마이그레이션 상태 저장 ──

const migration_state_path = join(workspace_root, ".migration-state.json");
const state = {
  version: 1,
  migrated_at: new Date().toISOString(),
  workspace_root,
  legacy_workspace: workspace_root,  // 기존 runtime 위치 (Phase 2에서 이동)
  admin_db: admin_db_path,
  teams: [team_slug],
  note: "Phase 1 완료: admin.db + team.db 생성. 기존 runtime 파일은 미이동.",
};
writeFileSync(migration_state_path, JSON.stringify(state, null, 2));
console.log(`\n마이그레이션 상태 저장: ${migration_state_path}`);

// ── 요약 ──

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Phase 1 마이그레이션 완료
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 생성된 구조:
   ${workspace_root}/
   ├── admin/
   │   ├── admin.db          ← superadmin + global providers
   │   └── security/         ← (vault.db 연결 예정)
   ├── tenants/
   │   └── ${team_slug}/
   │       ├── team.db       ← 팀 메타 + membership + team providers
   │       ├── shared/       ← 팀 공용 자산 (미사용)
   │       └── users/
   │           └── <user_id>/ ← 개인 workspace (현재 비어있음)
   └── .migration-state.json

 기존 runtime/ 파일 위치: ${workspace_root}/runtime/ (미이동)

 다음 단계 (Phase 2):
   bootstrap이 WorkspaceKey{team_id, user_id} 기반으로 업데이트된 후,
   기존 runtime/ → tenants/${team_slug}/users/<user_id>/runtime/ 이동 예정.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
