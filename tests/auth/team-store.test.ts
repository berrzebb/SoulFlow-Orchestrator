import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TeamStore } from "@src/auth/team-store.js";

const TEAM_ID = "test-team";

function make_store(): TeamStore {
  const db_path = join(tmpdir(), `team-store-test-${randomUUID()}.db`);
  return new TeamStore(db_path, TEAM_ID);
}

// ── 멤버십 ──────────────────────────────────────

describe("TeamStore — 멤버십 CRUD", () => {
  it("초기 상태: 멤버 없음", () => {
    expect(make_store().list_members()).toHaveLength(0);
  });

  it("upsert_member → 역할과 함께 저장", () => {
    const s = make_store();
    const m = s.upsert_member("user-1", "owner");
    expect(m.user_id).toBe("user-1");
    expect(m.role).toBe("owner");
    expect(m.team_id).toBe(TEAM_ID);
    expect(m.joined_at).toBeTruthy();
  });

  it("upsert_member 두 번 → 역할 업데이트 (upsert)", () => {
    const s = make_store();
    s.upsert_member("user-1", "member");
    const updated = s.upsert_member("user-1", "manager");
    expect(updated.role).toBe("manager");
    expect(s.list_members()).toHaveLength(1);
  });

  it("get_membership → 존재하는 유저 조회", () => {
    const s = make_store();
    s.upsert_member("user-2", "viewer");
    const m = s.get_membership("user-2");
    expect(m?.role).toBe("viewer");
  });

  it("get_membership → 없는 유저 null", () => {
    expect(make_store().get_membership("non-existent")).toBeNull();
  });

  it("list_members → 여러 멤버 반환", () => {
    const s = make_store();
    s.upsert_member("u1", "owner");
    s.upsert_member("u2", "member");
    s.upsert_member("u3", "viewer");
    expect(s.list_members()).toHaveLength(3);
  });

  it("remove_member → 삭제 후 조회 불가", () => {
    const s = make_store();
    s.upsert_member("user-del", "member");
    expect(s.remove_member("user-del")).toBe(true);
    expect(s.get_membership("user-del")).toBeNull();
    expect(s.list_members()).toHaveLength(0);
  });

  it("remove_member → 없는 유저 false", () => {
    expect(make_store().remove_member("nobody")).toBe(false);
  });

  it("모든 TeamRole 값 저장 가능", () => {
    const s = make_store();
    for (const role of ["owner", "manager", "member", "viewer"] as const) {
      s.upsert_member(`user-${role}`, role);
      expect(s.get_membership(`user-${role}`)?.role).toBe(role);
    }
  });
});

// ── 팀 프로바이더 ────────────────────────────────

describe("TeamStore — 팀 프로바이더 CRUD", () => {
  it("초기 상태: 프로바이더 없음", () => {
    expect(make_store().list_providers()).toHaveLength(0);
  });

  it("create_provider → id 자동 할당, 조회 가능", () => {
    const s = make_store();
    const p = s.create_provider({
      name: "gpt-4o", type: "openai", model: "gpt-4o",
      config: { temperature: 0.7 }, api_key_ref: "team.openai.key", enabled: true,
    });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("gpt-4o");
    expect(p.type).toBe("openai");
    expect(p.team_id).toBe(TEAM_ID);
    expect(p.config).toEqual({ temperature: 0.7 });
    expect(p.enabled).toBe(true);
  });

  it("get_provider → 단건 조회", () => {
    const s = make_store();
    const p = s.create_provider({ name: "claude", type: "anthropic", model: "claude-3-5-sonnet", config: {}, api_key_ref: "", enabled: true });
    expect(s.get_provider(p.id)?.name).toBe("claude");
  });

  it("get_provider → 없는 id null", () => {
    expect(make_store().get_provider("non-existent")).toBeNull();
  });

  it("list_providers enabled_only → 활성화된 것만 반환", () => {
    const s = make_store();
    s.create_provider({ name: "a", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    s.create_provider({ name: "b", type: "t", model: "", config: {}, api_key_ref: "", enabled: false });
    expect(s.list_providers(false)).toHaveLength(2);
    expect(s.list_providers(true)).toHaveLength(1);
  });

  it("update_provider → 필드 부분 업데이트", () => {
    const s = make_store();
    const p = s.create_provider({ name: "old-name", type: "t", model: "m1", config: {}, api_key_ref: "", enabled: true });
    const ok = s.update_provider(p.id, { name: "new-name", enabled: false });
    expect(ok).toBe(true);
    const updated = s.get_provider(p.id);
    expect(updated?.name).toBe("new-name");
    expect(updated?.enabled).toBe(false);
    expect(updated?.model).toBe("m1"); // 변경 안 됨
  });

  it("update_provider → 없는 id → false", () => {
    expect(make_store().update_provider("bad-id", { name: "x" })).toBe(false);
  });

  it("delete_provider → 삭제 후 조회 불가", () => {
    const s = make_store();
    const p = s.create_provider({ name: "del-me", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    expect(s.delete_provider(p.id)).toBe(true);
    expect(s.get_provider(p.id)).toBeNull();
  });

  it("delete_provider → 없는 id → false", () => {
    expect(make_store().delete_provider("bad-id")).toBe(false);
  });

  it("config JSON 직렬화·역직렬화 무결성", () => {
    const s = make_store();
    const complex_config = { nested: { a: 1 }, list: [1, 2, 3], flag: true };
    const p = s.create_provider({ name: "x", type: "t", model: "", config: complex_config, api_key_ref: "", enabled: true });
    expect(s.get_provider(p.id)?.config).toEqual(complex_config);
  });
});

// ── 팀 정책 ─────────────────────────────────────

describe("TeamStore — 팀 정책", () => {
  it("없는 키 → null", () => {
    expect(make_store().get_policy("allowed_providers")).toBeNull();
  });

  it("set_policy → get_policy 동일 값 반환", () => {
    const s = make_store();
    s.set_policy("max_tokens", 4096);
    expect(s.get_policy("max_tokens")).toBe(4096);
  });

  it("set_policy 두 번 → upsert", () => {
    const s = make_store();
    s.set_policy("key", "v1");
    s.set_policy("key", "v2");
    expect(s.get_policy("key")).toBe("v2");
  });

  it("복잡한 값 저장 가능 (배열, 객체)", () => {
    const s = make_store();
    const val = { providers: ["openai", "anthropic"], limits: { tokens: 8192 } };
    s.set_policy("config", val);
    expect(s.get_policy("config")).toEqual(val);
  });

  it("list_policies → 전체 반환", () => {
    const s = make_store();
    s.set_policy("k1", "v1");
    s.set_policy("k2", 42);
    const policies = s.list_policies();
    expect(policies).toHaveLength(2);
    expect(policies.find((p) => p.key === "k1")?.value).toBe("v1");
  });
});

// ── 팀 격리 ─────────────────────────────────────

describe("TeamStore — 팀 ID 격리", () => {
  it("다른 team_id를 가진 두 스토어는 데이터 공유 안 함", () => {
    const db_path = join(tmpdir(), `team-store-iso-${randomUUID()}.db`);
    const s1 = new TeamStore(db_path, "team-a");
    const s2 = new TeamStore(db_path, "team-b");
    s1.upsert_member("user-1", "owner");
    expect(s1.list_members()).toHaveLength(1);
    expect(s2.list_members()).toHaveLength(0);
  });
});
