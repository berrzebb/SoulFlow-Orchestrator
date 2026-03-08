/**
 * ConfigStore — SQLite CRUD + SecretVault 연동 테스트.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConfigStore } from "../../src/config/config-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretVaultLike } from "../../src/security/secret-vault.js";

function create_mock_vault(): SecretVaultLike {
  const store = new Map<string, string>();
  return {
    ensure_ready: vi.fn().mockResolvedValue(undefined),
    put_secret: vi.fn(async (name: string, value: string) => { store.set(name, value); }),
    reveal_secret: vi.fn(async (name: string) => store.get(name) ?? null),
    remove_secret: vi.fn(async (name: string) => { store.delete(name); }),
    get_secret_cipher: vi.fn(async (name: string) => store.has(name) ? "cipher" : null),
    list_secrets: vi.fn(async () => [...store.keys()]),
  } as unknown as SecretVaultLike;
}

describe("ConfigStore", () => {
  let workspace: string;
  let vault: SecretVaultLike;
  let store: ConfigStore;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfgstore-"));
    vault = create_mock_vault();
    store = new ConfigStore(join(workspace, "config.db"), vault);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  // ── 일반 설정 CRUD ──
  it("get_all_overrides: 초기 상태 빈 배열", () => {
    expect(store.get_all_overrides()).toEqual([]);
  });

  it("set_override + get_override: 값 저장 및 조회", () => {
    store.set_override("agentLoopMaxTurns", 50);
    expect(store.get_override("agentLoopMaxTurns")).toBe(50);
  });

  it("set_override: 같은 키에 덮어쓰기", () => {
    store.set_override("key1", "value1");
    store.set_override("key1", "value2");
    expect(store.get_override("key1")).toBe("value2");
    expect(store.get_all_overrides().length).toBe(1);
  });

  it("get_override: 존재하지 않는 키 → undefined", () => {
    expect(store.get_override("nonexistent")).toBeUndefined();
  });

  it("remove_override: 삭제 후 조회 불가", () => {
    store.set_override("to-remove", 42);
    store.remove_override("to-remove");
    expect(store.get_override("to-remove")).toBeUndefined();
  });

  it("get_all_overrides: 다수 오버라이드 반환", () => {
    store.set_override("a", 1);
    store.set_override("b.c", "hello");
    store.set_override("d.e.f", true);
    const overrides = store.get_all_overrides();
    expect(overrides.length).toBe(3);
    expect(overrides.map(o => o.path).sort()).toEqual(["a", "b.c", "d.e.f"]);
  });

  it("set_override: JSON 직렬화 가능한 복잡 값", () => {
    store.set_override("complex", { nested: [1, 2, 3] });
    expect(store.get_override("complex")).toEqual({ nested: [1, 2, 3] });
  });

  // ── 민감 설정 (SecretVault) ──
  it("set_sensitive + get_sensitive: vault에 위임", async () => {
    await store.set_sensitive("api.key", "secret-123");
    const val = await store.get_sensitive("api.key");
    expect(val).toBe("secret-123");
    expect(vault.ensure_ready).toHaveBeenCalled();
  });

  it("has_sensitive: 존재 여부 확인", async () => {
    expect(await store.has_sensitive("api.key")).toBe(false);
    await store.set_sensitive("api.key", "secret");
    expect(await store.has_sensitive("api.key")).toBe(true);
  });

  it("remove_sensitive: 삭제 후 조회 불가", async () => {
    await store.set_sensitive("api.key", "secret");
    await store.remove_sensitive("api.key");
    expect(await store.get_sensitive("api.key")).toBeNull();
  });

  // ── 통합 API ──
  it("set_value: 비민감 필드 → set_override로 라우팅", async () => {
    await store.set_value("agentLoopMaxTurns", 99);
    expect(store.get_override("agentLoopMaxTurns")).toBe(99);
  });

  it("remove_value: 비민감 필드 → remove_override로 라우팅", async () => {
    store.set_override("agentLoopMaxTurns", 99);
    await store.remove_value("agentLoopMaxTurns");
    expect(store.get_override("agentLoopMaxTurns")).toBeUndefined();
  });

  // ── get_section_status ──
  it("get_section_status: 섹션별 필드 상태 반환", async () => {
    const config = { agentLoopMaxTurns: 20, taskLoopMaxTurns: 50 };
    const status = await store.get_section_status("general", config);
    expect(status.length).toBeGreaterThan(0);
    const field = status.find(f => f.path === "agentLoopMaxTurns");
    expect(field).toBeDefined();
    expect(field!.value).toBe(20);
    expect(field!.overridden).toBe(false);
  });

  it("get_section_status: 오버라이드된 필드 표시", async () => {
    store.set_override("agentLoopMaxTurns", 99);
    const config = { agentLoopMaxTurns: 99, taskLoopMaxTurns: 50 };
    const status = await store.get_section_status("general", config);
    const field = status.find(f => f.path === "agentLoopMaxTurns");
    expect(field!.overridden).toBe(true);
    expect(field!.value).toBe(99);
  });

  // ── 영속성 ──
  it("persistence: 새 인스턴스에서 기존 오버라이드 유지", () => {
    store.set_override("persist.test", "hello");
    const store2 = new ConfigStore(join(workspace, "config.db"), vault);
    expect(store2.get_override("persist.test")).toBe("hello");
  });
});
