import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TeamStore } from "@src/auth/team-store.js";

function make_store(): TeamStore {
  const path = join(tmpdir(), `team-store-test-${randomUUID()}.db`);
  return new TeamStore(path);
}

describe("TeamStore — teams CRUD", () => {
  it("create_team → id 자동 할당, 조회 가능", () => {
    const s = make_store();
    const t = s.create_team({ slug: "eng", name: "Engineering" });
    expect(t.id).toBeTruthy();
    expect(t.slug).toBe("eng");
    expect(t.disabled_at).toBeNull();
    expect(s.get_team(t.id)?.name).toBe("Engineering");
  });

  it("get_team_by_slug 조회", () => {
    const s = make_store();
    s.create_team({ slug: "ops", name: "Operations" });
    expect(s.get_team_by_slug("ops")?.name).toBe("Operations");
    expect(s.get_team_by_slug("none")).toBeNull();
  });

  it("list_teams 전체 반환", () => {
    const s = make_store();
    s.create_team({ slug: "a", name: "A" });
    s.create_team({ slug: "b", name: "B" });
    expect(s.list_teams().length).toBe(2);
  });

  it("slug UNIQUE 제약 위반 시 예외", () => {
    const s = make_store();
    s.create_team({ slug: "dup", name: "First" });
    expect(() => s.create_team({ slug: "dup", name: "Second" })).toThrow();
  });

  it("update_team name 변경", () => {
    const s = make_store();
    const t = s.create_team({ slug: "x", name: "Old" });
    s.update_team(t.id, { name: "New" });
    expect(s.get_team(t.id)?.name).toBe("New");
  });

  it("update_team disabled_at 설정", () => {
    const s = make_store();
    const t = s.create_team({ slug: "y", name: "Y" });
    const ts = new Date().toISOString();
    s.update_team(t.id, { disabled_at: ts });
    expect(s.get_team(t.id)?.disabled_at).toBe(ts);
  });

  it("delete_team 후 null", () => {
    const s = make_store();
    const t = s.create_team({ slug: "z", name: "Z" });
    expect(s.delete_team(t.id)).toBe(true);
    expect(s.get_team(t.id)).toBeNull();
  });

  it("존재하지 않는 팀 delete → false", () => {
    expect(make_store().delete_team("ghost")).toBe(false);
  });
});

describe("TeamStore — memberships CRUD", () => {
  it("add_member → 조회 가능", () => {
    const s = make_store();
    const t = s.create_team({ slug: "eng", name: "Eng" });
    const m = s.add_member({ team_id: t.id, user_id: "u1", role: "owner" });
    expect(m.role).toBe("owner");
    expect(s.get_membership(t.id, "u1")?.role).toBe("owner");
  });

  it("list_members 팀별 반환", () => {
    const s = make_store();
    const t = s.create_team({ slug: "t", name: "T" });
    s.add_member({ team_id: t.id, user_id: "u1", role: "owner" });
    s.add_member({ team_id: t.id, user_id: "u2", role: "member" });
    expect(s.list_members(t.id).length).toBe(2);
  });

  it("중복 (team_id, user_id) 추가 → 예외", () => {
    const s = make_store();
    const t = s.create_team({ slug: "t2", name: "T2" });
    s.add_member({ team_id: t.id, user_id: "u1", role: "member" });
    expect(() => s.add_member({ team_id: t.id, user_id: "u1", role: "viewer" })).toThrow();
  });

  it("update_member_role 변경", () => {
    const s = make_store();
    const t = s.create_team({ slug: "t3", name: "T3" });
    s.add_member({ team_id: t.id, user_id: "u1", role: "member" });
    expect(s.update_member_role(t.id, "u1", "manager")).toBe(true);
    expect(s.get_membership(t.id, "u1")?.role).toBe("manager");
  });

  it("remove_member 후 null", () => {
    const s = make_store();
    const t = s.create_team({ slug: "t4", name: "T4" });
    s.add_member({ team_id: t.id, user_id: "u1", role: "member" });
    expect(s.remove_member(t.id, "u1")).toBe(true);
    expect(s.get_membership(t.id, "u1")).toBeNull();
  });
});

describe("TeamStore — team_providers CRUD", () => {
  it("create_team_provider → id 할당, 조회 가능", () => {
    const s = make_store();
    const p = s.create_team_provider({
      team_id: "t1", name: "Team GPT", type: "openai", model: "gpt-4o",
      config: { base_url: "https://api.openai.com" }, api_key_ref: "team.openai.key", enabled: true,
    });
    expect(p.id).toBeTruthy();
    expect(p.team_id).toBe("t1");
    expect(s.get_team_provider(p.id)?.name).toBe("Team GPT");
  });

  it("list_team_providers enabled_only 필터링", () => {
    const s = make_store();
    s.create_team_provider({ team_id: "t1", name: "A", type: "openai", model: "m", config: {}, api_key_ref: "k1", enabled: true });
    s.create_team_provider({ team_id: "t1", name: "B", type: "anthropic", model: "m", config: {}, api_key_ref: "k2", enabled: false });
    expect(s.list_team_providers("t1", true).length).toBe(1);
    expect(s.list_team_providers("t1", false).length).toBe(2);
  });

  it("다른 team_id는 별개 목록", () => {
    const s = make_store();
    s.create_team_provider({ team_id: "t1", name: "P1", type: "openai", model: "m", config: {}, api_key_ref: "k", enabled: true });
    s.create_team_provider({ team_id: "t2", name: "P2", type: "openai", model: "m", config: {}, api_key_ref: "k", enabled: true });
    expect(s.list_team_providers("t1").length).toBe(1);
    expect(s.list_team_providers("t2").length).toBe(1);
  });

  it("update_team_provider config 변경", () => {
    const s = make_store();
    const p = s.create_team_provider({ team_id: "t1", name: "X", type: "t", model: "m", config: {}, api_key_ref: "k", enabled: true });
    s.update_team_provider(p.id, { config: { timeout: 30 } });
    expect(s.get_team_provider(p.id)?.config.timeout).toBe(30);
  });

  it("delete_team_provider 후 null", () => {
    const s = make_store();
    const p = s.create_team_provider({ team_id: "t1", name: "Y", type: "t", model: "m", config: {}, api_key_ref: "k", enabled: true });
    expect(s.delete_team_provider(p.id)).toBe(true);
    expect(s.get_team_provider(p.id)).toBeNull();
  });
});

describe("TeamStore — team_policies", () => {
  it("set_policy → get_policy 동일 값", () => {
    const s = make_store();
    s.set_policy("allowed_providers", ["openai", "anthropic"]);
    expect(s.get_policy("allowed_providers")).toEqual(["openai", "anthropic"]);
  });

  it("없는 키 → null", () => {
    expect(make_store().get_policy("missing")).toBeNull();
  });

  it("set_policy 두 번 호출 시 upsert", () => {
    const s = make_store();
    s.set_policy("limit", 10);
    s.set_policy("limit", 20);
    expect(s.get_policy("limit")).toBe(20);
  });

  it("delete_policy 후 null", () => {
    const s = make_store();
    s.set_policy("flag", true);
    expect(s.delete_policy("flag")).toBe(true);
    expect(s.get_policy("flag")).toBeNull();
  });
});
