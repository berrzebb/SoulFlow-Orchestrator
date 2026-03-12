import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AdminStore } from "@src/auth/admin-store.js";
import { TeamStore } from "@src/auth/team-store.js";
import { ScopedProviderResolver } from "@src/auth/scoped-provider-resolver.js";

function make_workspace(): string {
  return join(tmpdir(), `resolver-test-${randomUUID()}`);
}

function make_admin(root: string): AdminStore {
  return new AdminStore(join(root, "admin", "admin.db"));
}

function make_team_store(root: string, team_id: string): TeamStore {
  return new TeamStore(join(root, "tenants", team_id, "team.db"), team_id);
}

function make_resolver(root: string): ScopedProviderResolver {
  return new ScopedProviderResolver(make_admin(root), root);
}

describe("ScopedProviderResolver — list()", () => {
  it("팀·전역 프로바이더 없으면 빈 배열", () => {
    const root = make_workspace();
    const resolver = make_resolver(root);
    expect(resolver.list("team-1")).toHaveLength(0);
  });

  it("전역 프로바이더만 있으면 scope=global로 반환", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "gpt-4", type: "openai", model: "gpt-4", config: {}, api_key_ref: "k", enabled: true });
    const resolver = new ScopedProviderResolver(admin, root);
    const list = resolver.list("team-1");
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("global");
    expect(list[0].name).toBe("gpt-4");
  });

  it("팀 프로바이더만 있으면 scope=team으로 반환", () => {
    const root = make_workspace();
    make_team_store(root, "team-1").create_provider({
      name: "claude", type: "anthropic", model: "claude-3-5-sonnet", config: {}, api_key_ref: "", enabled: true,
    });
    const resolver = make_resolver(root);
    const list = resolver.list("team-1");
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("team");
    expect(list[0].team_id).toBe("team-1");
  });

  it("전역·팀 모두 있으면 병합, 팀이 먼저", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "gpt-4", type: "openai", model: "gpt-4", config: {}, api_key_ref: "", enabled: true });
    make_team_store(root, "team-1").create_provider({
      name: "claude", type: "anthropic", model: "claude-3-5", config: {}, api_key_ref: "", enabled: true,
    });
    const resolver = new ScopedProviderResolver(admin, root);
    const list = resolver.list("team-1");
    expect(list).toHaveLength(2);
    expect(list[0].scope).toBe("team");   // 팀이 먼저
    expect(list[1].scope).toBe("global");
  });

  it("같은 name+type → 팀이 전역 override (전역은 숨김)", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "gpt-4", type: "openai", model: "gpt-3.5", config: {}, api_key_ref: "", enabled: true });
    make_team_store(root, "team-1").create_provider({
      name: "gpt-4", type: "openai", model: "gpt-4o", config: {}, api_key_ref: "", enabled: true,
    });
    const resolver = new ScopedProviderResolver(admin, root);
    const list = resolver.list("team-1");
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("team");
    expect(list[0].model).toBe("gpt-4o"); // 팀 버전 사용
  });

  it("enabled_only=true → 비활성화 항목 제외", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "p1", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    admin.create_shared_provider({ name: "p2", type: "t", model: "", config: {}, api_key_ref: "", enabled: false });
    const resolver = new ScopedProviderResolver(admin, root);
    expect(resolver.list("team-1", false)).toHaveLength(2);
    expect(resolver.list("team-1", true)).toHaveLength(1);
  });

  it("다른 팀의 프로바이더는 포함되지 않음", () => {
    const root = make_workspace();
    make_team_store(root, "team-A").create_provider({ name: "p", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    const resolver = make_resolver(root);
    expect(resolver.list("team-B")).toHaveLength(0);
    expect(resolver.list("team-A")).toHaveLength(1);
  });
});

describe("ScopedProviderResolver — find()", () => {
  it("팀 프로바이더 name+type 조회", () => {
    const root = make_workspace();
    make_team_store(root, "t1").create_provider({ name: "claude", type: "anthropic", model: "s", config: {}, api_key_ref: "", enabled: true });
    const resolver = make_resolver(root);
    const p = resolver.find("t1", "claude", "anthropic");
    expect(p?.scope).toBe("team");
  });

  it("팀 없을 때 전역 fallback", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "gpt-4", type: "openai", model: "gpt-4", config: {}, api_key_ref: "", enabled: true });
    const resolver = new ScopedProviderResolver(admin, root);
    const p = resolver.find("no-team", "gpt-4", "openai");
    expect(p?.scope).toBe("global");
  });

  it("팀·전역 모두 없으면 null", () => {
    expect(make_resolver(make_workspace()).find("team-1", "unknown", "type")).toBeNull();
  });

  it("팀 프로바이더가 전역 override", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    admin.create_shared_provider({ name: "gpt-4", type: "openai", model: "global-model", config: {}, api_key_ref: "", enabled: true });
    make_team_store(root, "t1").create_provider({ name: "gpt-4", type: "openai", model: "team-model", config: {}, api_key_ref: "", enabled: true });
    const resolver = new ScopedProviderResolver(admin, root);
    const p = resolver.find("t1", "gpt-4", "openai");
    expect(p?.scope).toBe("team");
    expect(p?.model).toBe("team-model");
  });
});

describe("ScopedProviderResolver — get_by_id()", () => {
  it("scope=global → AdminStore에서 조회", () => {
    const root = make_workspace();
    const admin = make_admin(root);
    const created = admin.create_shared_provider({ name: "x", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    const resolver = new ScopedProviderResolver(admin, root);
    const p = resolver.get_by_id("any-team", created.id, "global");
    expect(p?.id).toBe(created.id);
    expect(p?.scope).toBe("global");
  });

  it("scope=team → TeamStore에서 조회", () => {
    const root = make_workspace();
    const created = make_team_store(root, "t1").create_provider({ name: "y", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    const resolver = make_resolver(root);
    const p = resolver.get_by_id("t1", created.id, "team");
    expect(p?.id).toBe(created.id);
    expect(p?.scope).toBe("team");
  });

  it("존재하지 않는 id → null", () => {
    const root = make_workspace();
    const resolver = make_resolver(root);
    expect(resolver.get_by_id("t1", "bad-id", "global")).toBeNull();
    expect(resolver.get_by_id("t1", "bad-id", "team")).toBeNull();
  });
});

describe("ScopedProviderResolver — open_team_store()", () => {
  it("team.db 없어도 생성하여 반환", () => {
    const root = make_workspace();
    const resolver = make_resolver(root);
    const store = resolver.open_team_store("new-team");
    expect(store.list_providers()).toHaveLength(0); // DB가 생성됨
    store.upsert_member("u1", "owner");
    expect(store.get_membership("u1")?.role).toBe("owner");
  });
});
