import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AdminStore } from "@src/auth/admin-store.js";

function make_store(): AdminStore {
  const path = join(tmpdir(), `admin-store-test-${randomUUID()}.db`);
  return new AdminStore(path);
}

describe("AdminStore — is_initialized", () => {
  it("admin 계정 없으면 false", () => {
    expect(make_store().is_initialized()).toBe(false);
  });

  it("admin 계정 생성 후 true", () => {
    const s = make_store();
    s.create_user({ username: "admin", password_hash: "x", role: "admin", workspace_path: "/ws/admin" });
    expect(s.is_initialized()).toBe(true);
  });

  it("일반 user만 있으면 false", () => {
    const s = make_store();
    s.create_user({ username: "user1", password_hash: "x", role: "user", workspace_path: "/ws/u1" });
    expect(s.is_initialized()).toBe(false);
  });
});

describe("AdminStore — settings", () => {
  it("없는 키는 null 반환", () => {
    expect(make_store().get_setting("jwt_secret")).toBeNull();
  });

  it("set 후 get 동일 값 반환", () => {
    const s = make_store();
    s.set_setting("jwt_secret", "mysecret");
    expect(s.get_setting("jwt_secret")).toBe("mysecret");
  });

  it("set 두 번 호출 시 upsert", () => {
    const s = make_store();
    s.set_setting("k", "v1");
    s.set_setting("k", "v2");
    expect(s.get_setting("k")).toBe("v2");
  });
});

describe("AdminStore — users CRUD", () => {
  it("create_user → id 자동 할당, 조회 가능", () => {
    const s = make_store();
    const u = s.create_user({ username: "alice", password_hash: "hash", role: "user", workspace_path: "/ws/alice" });
    expect(u.id).toBeTruthy();
    expect(u.username).toBe("alice");
    expect(s.get_user_by_id(u.id)).toMatchObject({ username: "alice" });
  });

  it("get_user_by_username 조회", () => {
    const s = make_store();
    s.create_user({ username: "bob", password_hash: "h", role: "user", workspace_path: "/ws/bob" });
    expect(s.get_user_by_username("bob")?.username).toBe("bob");
    expect(s.get_user_by_username("nobody")).toBeNull();
  });

  it("list_users 전체 반환", () => {
    const s = make_store();
    s.create_user({ username: "a", password_hash: "h", role: "admin", workspace_path: "/ws/a" });
    s.create_user({ username: "b", password_hash: "h", role: "user", workspace_path: "/ws/b" });
    expect(s.list_users().length).toBe(2);
  });

  it("update_user password_hash 변경", () => {
    const s = make_store();
    const u = s.create_user({ username: "c", password_hash: "old", role: "user", workspace_path: "/ws/c" });
    s.update_user(u.id, { password_hash: "new" });
    expect(s.get_user_by_id(u.id)?.password_hash).toBe("new");
  });

  it("delete_user → 이후 조회 null", () => {
    const s = make_store();
    const u = s.create_user({ username: "d", password_hash: "h", role: "user", workspace_path: "/ws/d" });
    expect(s.delete_user(u.id)).toBe(true);
    expect(s.get_user_by_id(u.id)).toBeNull();
  });

  it("존재하지 않는 user delete → false", () => {
    expect(make_store().delete_user("nonexistent")).toBe(false);
  });

  it("username UNIQUE 제약 위반 시 예외", () => {
    const s = make_store();
    s.create_user({ username: "dup", password_hash: "h", role: "user", workspace_path: "/ws/1" });
    expect(() =>
      s.create_user({ username: "dup", password_hash: "h", role: "user", workspace_path: "/ws/2" })
    ).toThrow();
  });
});

describe("AdminStore — shared_providers CRUD", () => {
  it("create → id 할당, 조회 가능", () => {
    const s = make_store();
    const p = s.create_shared_provider({
      name: "Shared OpenAI", type: "openai", model: "gpt-4o",
      config: { base_url: "https://api.openai.com" }, api_key_ref: "shared.openai.key", enabled: true,
    });
    expect(p.id).toBeTruthy();
    expect(s.get_shared_provider(p.id)?.name).toBe("Shared OpenAI");
  });

  it("list_shared_providers enabled_only 필터링", () => {
    const s = make_store();
    s.create_shared_provider({ name: "A", type: "openai", model: "m", config: {}, api_key_ref: "k1", enabled: true });
    s.create_shared_provider({ name: "B", type: "anthropic", model: "m", config: {}, api_key_ref: "k2", enabled: false });
    expect(s.list_shared_providers(true).length).toBe(1);
    expect(s.list_shared_providers(false).length).toBe(2);
  });

  it("update_shared_provider enabled 토글", () => {
    const s = make_store();
    const p = s.create_shared_provider({ name: "X", type: "t", model: "m", config: {}, api_key_ref: "k", enabled: true });
    s.update_shared_provider(p.id, { enabled: false });
    expect(s.get_shared_provider(p.id)?.enabled).toBe(false);
  });

  it("delete_shared_provider 후 null", () => {
    const s = make_store();
    const p = s.create_shared_provider({ name: "Y", type: "t", model: "m", config: {}, api_key_ref: "k", enabled: true });
    expect(s.delete_shared_provider(p.id)).toBe(true);
    expect(s.get_shared_provider(p.id)).toBeNull();
  });
});
