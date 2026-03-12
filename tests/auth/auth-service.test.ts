import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AdminStore } from "@src/auth/admin-store.js";
import { AuthService } from "@src/auth/auth-service.js";

function make_svc(): { store: AdminStore; svc: AuthService } {
  const path = join(tmpdir(), `auth-svc-test-${randomUUID()}.db`);
  const store = new AdminStore(path);
  const svc = new AuthService(store);
  return { store, svc };
}

describe("AuthService — hash_password / verify_password", () => {
  it("해시 후 검증 성공", () => {
    const { svc } = make_svc();
    const hash = svc.hash_password("correcthorsebatterystaple");
    expect(svc.verify_password("correcthorsebatterystaple", hash)).toBe(true);
  });

  it("틀린 비밀번호 → false", () => {
    const { svc } = make_svc();
    const hash = svc.hash_password("right");
    expect(svc.verify_password("wrong", hash)).toBe(false);
  });

  it("같은 비밀번호라도 해시는 매번 다름 (salt)", () => {
    const { svc } = make_svc();
    const h1 = svc.hash_password("pass");
    const h2 = svc.hash_password("pass");
    expect(h1).not.toBe(h2);
  });

  it("빈 비밀번호 해싱 가능", () => {
    const { svc } = make_svc();
    const hash = svc.hash_password("");
    expect(svc.verify_password("", hash)).toBe(true);
  });
});

describe("AuthService — JWT sign / verify", () => {
  it("발급 → 검증 성공, payload 일치", () => {
    const { svc } = make_svc();
    const token = svc.sign_token({ sub: "u1", usr: "alice", role: "superadmin" });
    const p = svc.verify_token(token);
    expect(p).not.toBeNull();
    expect(p!.sub).toBe("u1");
    expect(p!.usr).toBe("alice");
    expect(p!.role).toBe("superadmin");
  });

  it("user role JWT 발급", () => {
    const { svc } = make_svc();
    const token = svc.sign_token({ sub: "u2", usr: "bob", role: "user" });
    expect(svc.verify_token(token)?.role).toBe("user");
  });

  it("조작된 서명 → null", () => {
    const { svc } = make_svc();
    const token = svc.sign_token({ sub: "u1", usr: "alice", role: "user" });
    const tampered = token.slice(0, -4) + "XXXX";
    expect(svc.verify_token(tampered)).toBeNull();
  });

  it("만료 기간 내 유효", () => {
    const { svc } = make_svc();
    const token = svc.sign_token({ sub: "u2", usr: "bob", role: "user" });
    expect(svc.verify_token(token)).not.toBeNull();
  });

  it("형식 불일치 (2 파트) → null", () => {
    const { svc } = make_svc();
    expect(svc.verify_token("header.body")).toBeNull();
  });

  it("빈 문자열 → null", () => {
    const { svc } = make_svc();
    expect(svc.verify_token("")).toBeNull();
  });

  it("다른 store 시크릿으로 발급한 토큰 → null", () => {
    const { svc } = make_svc();
    const { svc: svc2 } = make_svc();
    const token = svc.sign_token({ sub: "u1", usr: "alice", role: "user" });
    expect(svc2.verify_token(token)).toBeNull();
  });
});

describe("AuthService — login", () => {
  it("올바른 credentials → token 반환", async () => {
    const { store, svc } = make_svc();
    const hash = svc.hash_password("secret");
    store.create_user({ username: "alice", password_hash: hash, system_role: "user" });

    const result = await svc.login("alice", "secret");
    expect(result).not.toBeNull();
    expect(result!.payload.usr).toBe("alice");
    expect(result!.token.split(".").length).toBe(3);
  });

  it("superadmin 로그인 → role = superadmin", async () => {
    const { store, svc } = make_svc();
    const hash = svc.hash_password("adminpw");
    store.create_user({ username: "root", password_hash: hash, system_role: "superadmin" });
    const result = await svc.login("root", "adminpw");
    expect(result!.payload.role).toBe("superadmin");
  });

  it("틀린 비밀번호 → null", async () => {
    const { store, svc } = make_svc();
    const hash = svc.hash_password("real");
    store.create_user({ username: "bob", password_hash: hash, system_role: "user" });
    expect(await svc.login("bob", "wrong")).toBeNull();
  });

  it("존재하지 않는 사용자 → null", async () => {
    const { svc } = make_svc();
    expect(await svc.login("nobody", "pass")).toBeNull();
  });

  it("login 성공 시 last_login_at 갱신", async () => {
    const { store, svc } = make_svc();
    const hash = svc.hash_password("pw");
    const user = store.create_user({ username: "carol", password_hash: hash, system_role: "superadmin" });
    expect(user.last_login_at).toBeNull();
    await svc.login("carol", "pw");
    expect(store.get_user_by_id(user.id)?.last_login_at).not.toBeNull();
  });
});

describe("AuthService — 전역 프로바이더 위임", () => {
  it("create_shared_provider → list_shared_providers에서 조회 가능", () => {
    const { svc } = make_svc();
    svc.create_shared_provider({ name: "gpt-4", type: "openai", model: "gpt-4", config: {}, api_key_ref: "key", enabled: true });
    const list = svc.list_shared_providers();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("gpt-4");
  });

  it("list_shared_providers enabled_only → 활성화된 것만", () => {
    const { svc } = make_svc();
    svc.create_shared_provider({ name: "p1", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    svc.create_shared_provider({ name: "p2", type: "t", model: "", config: {}, api_key_ref: "", enabled: false });
    expect(svc.list_shared_providers(false)).toHaveLength(2);
    expect(svc.list_shared_providers(true)).toHaveLength(1);
  });

  it("get_shared_provider → id로 단건 조회", () => {
    const { svc } = make_svc();
    const p = svc.create_shared_provider({ name: "claude", type: "anthropic", model: "s", config: {}, api_key_ref: "", enabled: true });
    expect(svc.get_shared_provider(p.id)?.name).toBe("claude");
  });

  it("get_shared_provider → 없는 id null", () => {
    const { svc } = make_svc();
    expect(svc.get_shared_provider("bad-id")).toBeNull();
  });

  it("update_shared_provider → 필드 수정", () => {
    const { svc } = make_svc();
    const p = svc.create_shared_provider({ name: "old", type: "t", model: "m1", config: {}, api_key_ref: "", enabled: true });
    svc.update_shared_provider(p.id, { name: "new", enabled: false });
    const updated = svc.get_shared_provider(p.id);
    expect(updated?.name).toBe("new");
    expect(updated?.enabled).toBe(false);
    expect(updated?.model).toBe("m1");
  });

  it("delete_shared_provider → 삭제 후 조회 불가", () => {
    const { svc } = make_svc();
    const p = svc.create_shared_provider({ name: "del", type: "t", model: "", config: {}, api_key_ref: "", enabled: true });
    expect(svc.delete_shared_provider(p.id)).toBe(true);
    expect(svc.get_shared_provider(p.id)).toBeNull();
  });
});
