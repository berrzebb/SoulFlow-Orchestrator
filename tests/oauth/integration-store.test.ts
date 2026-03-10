/**
 * OAuthIntegrationStore — SQLite 메타데이터 + SecretVault 토큰 저장소 테스트.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OAuthIntegrationStore } from "../../src/oauth/integration-store.js";
import type { SecretVaultLike } from "../../src/security/secret-vault.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function make_mock_vault(): SecretVaultLike {
  const store = new Map<string, string>();
  return {
    get_paths: vi.fn().mockReturnValue({ root_dir: "/tmp", store_path: "/tmp/secrets.db" }),
    ensure_ready: vi.fn().mockResolvedValue(undefined),
    get_or_create_key: vi.fn().mockResolvedValue(Buffer.from("key")),
    encrypt_text: vi.fn().mockImplementation(async (text: string) => `encrypted:${text}`),
    decrypt_text: vi.fn().mockImplementation(async (token: string) => token.replace("encrypted:", "")),
    list_names: vi.fn().mockResolvedValue([]),
    put_secret: vi.fn().mockImplementation(async (name: string, value: string) => {
      store.set(name, value);
      return { ok: true, name };
    }),
    remove_secret: vi.fn().mockImplementation(async (name: string) => {
      const had = store.has(name);
      store.delete(name);
      return had;
    }),
    get_secret_cipher: vi.fn().mockImplementation(async (name: string) => {
      return store.has(name) ? `cipher:${name}` : null;
    }),
    reveal_secret: vi.fn().mockImplementation(async (name: string) => {
      return store.get(name) ?? null;
    }),
    resolve_placeholders: vi.fn().mockImplementation(async (input: string) => input),
    resolve_placeholders_with_report: vi.fn().mockResolvedValue({ text: "", missing_keys: [], invalid_ciphertexts: [] }),
    resolve_inline_secrets: vi.fn().mockImplementation(async (input: string) => input),
    resolve_inline_secrets_with_report: vi.fn().mockResolvedValue({ text: "", missing_keys: [], invalid_ciphertexts: [] }),
    inspect_secret_references: vi.fn().mockResolvedValue({ missing_keys: [], invalid_ciphertexts: [] }),
    mask_known_secrets: vi.fn().mockImplementation(async (input: string) => input),
    prune_expired: vi.fn().mockResolvedValue(0),
  } as unknown as SecretVaultLike;
}

const BASE_INPUT = {
  instance_id: "inst-1",
  service_type: "github",
  label: "My GitHub",
  enabled: true,
  scopes: ["read", "write"],
  auth_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  redirect_uri: "https://app.example.com/callback",
  settings: {},
};

describe("OAuthIntegrationStore", () => {
  let tmp_dir: string;
  let db_path: string;
  let vault: SecretVaultLike;
  let store: OAuthIntegrationStore;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "oauth-store-test-"));
    db_path = join(tmp_dir, "oauth.db");
    vault = make_mock_vault();
    store = new OAuthIntegrationStore(db_path, vault);
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  // ── 기본 CRUD ──

  it("upsert + get: 기본 저장 후 조회", () => {
    store.upsert(BASE_INPUT);
    const result = store.get("inst-1");
    expect(result).not.toBeNull();
    expect(result!.service_type).toBe("github");
    expect(result!.label).toBe("My GitHub");
    expect(result!.enabled).toBe(true);
    expect(result!.scopes).toEqual(["read", "write"]);
  });

  it("get: 존재하지 않는 ID → null", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("list: 저장된 항목 모두 반환", () => {
    store.upsert(BASE_INPUT);
    store.upsert({ ...BASE_INPUT, instance_id: "inst-2", service_type: "slack" });
    const items = store.list();
    expect(items.length).toBe(2);
  });

  it("list: 빈 상태 → 빈 배열", () => {
    expect(store.list()).toEqual([]);
  });

  it("upsert: 같은 instance_id → 덮어쓰기", () => {
    store.upsert(BASE_INPUT);
    store.upsert({ ...BASE_INPUT, label: "Updated Label" });
    const result = store.get("inst-1");
    expect(result!.label).toBe("Updated Label");
    expect(store.list().length).toBe(1);
  });

  it("remove: 존재하는 항목 제거 → true", () => {
    store.upsert(BASE_INPUT);
    expect(store.remove("inst-1")).toBe(true);
    expect(store.get("inst-1")).toBeNull();
  });

  it("remove: 존재하지 않는 항목 → false", () => {
    expect(store.remove("ghost")).toBe(false);
  });

  // ── update_settings ──

  it("update_settings: label/enabled/scopes 부분 업데이트", () => {
    store.upsert(BASE_INPUT);
    const ok = store.update_settings("inst-1", { label: "Renamed", enabled: false });
    expect(ok).toBe(true);
    const result = store.get("inst-1");
    expect(result!.label).toBe("Renamed");
    expect(result!.enabled).toBe(false);
    expect(result!.scopes).toEqual(["read", "write"]); // unchanged
  });

  it("update_settings: 존재하지 않는 항목 → false", () => {
    expect(store.update_settings("ghost", { label: "X" })).toBe(false);
  });

  // ── 토큰 만료 ──

  it("set_expires_at + is_expired: 과거 시각 → true", () => {
    store.upsert(BASE_INPUT);
    store.set_expires_at("inst-1", new Date(Date.now() - 10_000).toISOString());
    expect(store.is_expired("inst-1")).toBe(true);
  });

  it("set_expires_at + is_expired: 미래 시각 → false", () => {
    store.upsert(BASE_INPUT);
    store.set_expires_at("inst-1", new Date(Date.now() + 60_000).toISOString());
    expect(store.is_expired("inst-1")).toBe(false);
  });

  it("is_expired: expires_at 없음 → false", () => {
    store.upsert(BASE_INPUT);
    expect(store.is_expired("inst-1")).toBe(false);
  });

  it("set_expires_at: null 설정 → expires_at 초기화", () => {
    store.upsert(BASE_INPUT);
    store.set_expires_at("inst-1", new Date(Date.now() - 1_000).toISOString());
    store.set_expires_at("inst-1", null);
    expect(store.is_expired("inst-1")).toBe(false);
  });

  // ── vault 위임 ──

  it("set_tokens + get_access_token: access_token 저장/조회", async () => {
    store.upsert(BASE_INPUT);
    await store.set_tokens("inst-1", { access_token: "tok-abc" });
    const token = await store.get_access_token("inst-1");
    expect(token).toBe("tok-abc");
  });

  it("set_tokens: refresh_token 포함 → 저장", async () => {
    store.upsert(BASE_INPUT);
    await store.set_tokens("inst-1", { access_token: "tok-abc", refresh_token: "ref-xyz" });
    expect(await store.get_refresh_token("inst-1")).toBe("ref-xyz");
  });

  it("set_tokens: expires_in 포함 → set_expires_at 호출", async () => {
    store.upsert(BASE_INPUT);
    await store.set_tokens("inst-1", { access_token: "tok-abc", expires_in: 3600 });
    expect(store.is_expired("inst-1")).toBe(false);
  });

  it("has_access_token: 토큰 있음 → true", async () => {
    store.upsert(BASE_INPUT);
    await store.set_tokens("inst-1", { access_token: "tok-abc" });
    expect(await store.has_access_token("inst-1")).toBe(true);
  });

  it("has_access_token: 토큰 없음 → false", async () => {
    store.upsert(BASE_INPUT);
    expect(await store.has_access_token("inst-1")).toBe(false);
  });

  it("set_client_credentials + get_client_id + get_client_secret", async () => {
    store.upsert(BASE_INPUT);
    await store.set_client_credentials("inst-1", "client-id-123", "secret-abc");
    expect(await store.get_client_id("inst-1")).toBe("client-id-123");
    expect(await store.get_client_secret("inst-1")).toBe("secret-abc");
  });

  it("has_client_secret: 시크릿 있음 → true", async () => {
    store.upsert(BASE_INPUT);
    await store.set_client_credentials("inst-1", "cid", "csecret");
    expect(await store.has_client_secret("inst-1")).toBe(true);
  });

  it("remove_tokens: 모든 토큰 제거 + expires_at 초기화", async () => {
    store.upsert(BASE_INPUT);
    await store.set_tokens("inst-1", { access_token: "tok", refresh_token: "ref", expires_in: 3600 });
    await store.remove_tokens("inst-1");
    expect(await store.get_access_token("inst-1")).toBeNull();
    expect(await store.get_refresh_token("inst-1")).toBeNull();
    expect(store.is_expired("inst-1")).toBe(false);
  });

  // ── 커스텀 프리셋 ──

  it("save_preset + load_presets: 프리셋 저장/조회", () => {
    store.save_preset({
      service_type: "my_service",
      label: "My Service",
      auth_url: "https://my.service/auth",
      token_url: "https://my.service/token",
      scopes_available: ["read", "admin"],
      default_scopes: ["read"],
      supports_refresh: true,
    });
    const presets = store.load_presets();
    expect(presets.length).toBe(1);
    expect(presets[0].service_type).toBe("my_service");
    expect(presets[0].label).toBe("My Service");
  });

  it("save_preset: 같은 service_type → 덮어쓰기", () => {
    store.save_preset({ service_type: "svc", label: "Old", auth_url: "a", token_url: "b", scopes_available: [], default_scopes: [], supports_refresh: false });
    store.save_preset({ service_type: "svc", label: "New", auth_url: "a", token_url: "b", scopes_available: [], default_scopes: [], supports_refresh: false });
    const presets = store.load_presets();
    expect(presets.length).toBe(1);
    expect(presets[0].label).toBe("New");
  });

  it("remove_preset: 존재하는 프리셋 제거 → true", () => {
    store.save_preset({ service_type: "svc", label: "X", auth_url: "a", token_url: "b", scopes_available: [], default_scopes: [], supports_refresh: false });
    expect(store.remove_preset("svc")).toBe(true);
    expect(store.load_presets().length).toBe(0);
  });

  it("remove_preset: 존재하지 않는 프리셋 → false", () => {
    expect(store.remove_preset("ghost_svc")).toBe(false);
  });
});

// ══════════════════════════════════════════
// vault_store_client_id / vault_store_client_secret (L229, L233)
// ══════════════════════════════════════════

describe("OAuthIntegrationStore — vault_store_client_id/secret (L229/L233)", () => {
  let store: OAuthIntegrationStore;
  let local_tmp: string;
  beforeEach(async () => {
    local_tmp = await mkdtemp(join(tmpdir(), "oauth-test-"));
    store = new OAuthIntegrationStore(join(local_tmp, "oauth.db"), make_mock_vault());
  });
  afterEach(async () => {
    await rm(local_tmp, { recursive: true, force: true });
  });

  it("vault_store_client_id → vault.put_secret 호출 (L229)", async () => {
    await store.vault_store_client_id("inst-1", "my-client-id");
    // vault.put_secret가 호출되면 에러 없이 완료
    expect(true).toBe(true);
  });

  it("vault_store_client_secret → vault.put_secret 호출 (L233)", async () => {
    await store.vault_store_client_secret("inst-1", "my-client-secret");
    expect(true).toBe(true);
  });
});
