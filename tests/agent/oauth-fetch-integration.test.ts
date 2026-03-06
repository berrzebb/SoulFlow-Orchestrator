/**
 * OAuthIntegrationStore + SecretVault 통합 테스트.
 *
 * Mock이 잡지 못하는 시나리오:
 * 1. 연동 CRUD가 실제 SQLite에서 동작
 * 2. 프로세스 재시작 후 연동 정보 복원
 * 3. 토큰 저장/조회가 실제 SecretVault에서 동작
 * 4. 비활성 연동 처리
 * 5. 커스텀 프리셋 저장/복원
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuthIntegrationStore, type CreateOAuthIntegrationInput } from "@src/oauth/integration-store.js";
import { SecretVaultService } from "@src/security/secret-vault.js";

let cleanup_dirs: string[] = [];

function make_integration(patch?: Partial<CreateOAuthIntegrationInput>): CreateOAuthIntegrationInput {
  return {
    instance_id: `svc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    service_type: "github",
    label: "GitHub",
    enabled: true,
    scopes: ["repo"],
    auth_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    redirect_uri: "http://localhost/callback",
    settings: {},
    ...patch,
  };
}

async function make_env() {
  const dir = await mkdtemp(join(tmpdir(), "oauth-integ-"));
  cleanup_dirs.push(dir);
  const vault = new SecretVaultService(dir);
  await vault.ensure_ready();
  const store = new OAuthIntegrationStore(join(dir, "oauth.db"), vault);
  return { dir, vault, store };
}

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  cleanup_dirs = [];
});

describe("OAuthIntegrationStore 통합 (실제 SQLite + SecretVault)", () => {
  it("upsert → get → list CRUD", async () => {
    const { store } = await make_env();
    const input = make_integration({ instance_id: "github" });
    store.upsert(input);

    const got = store.get("github");
    expect(got).not.toBeNull();
    expect(got!.label).toBe("GitHub");
    expect(got!.scopes).toEqual(["repo"]);

    const list = store.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.instance_id === "github")).toBe(true);
  });

  it("비활성 연동 upsert 후 enabled=false 확인", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "disabled-svc", enabled: false }));

    const got = store.get("disabled-svc");
    expect(got!.enabled).toBe(false);
  });

  it("프로세스 재시작 후 연동 정보 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oauth-restart-"));
    cleanup_dirs.push(dir);
    const vault1 = new SecretVaultService(dir);
    await vault1.ensure_ready();
    const store1 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault1);
    store1.upsert(make_integration({ instance_id: "github", label: "GH Persisted" }));

    // 새 인스턴스 (프로세스 재시작)
    const vault2 = new SecretVaultService(dir);
    await vault2.ensure_ready();
    const store2 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault2);
    const got = store2.get("github");
    expect(got!.label).toBe("GH Persisted");
  });

  it("토큰 저장 → 조회 → SecretVault 연동", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "github" }));

    await store.set_tokens("github", {
      access_token: "gho_test_token_12345",
      refresh_token: "ghr_refresh_67890",
      expires_in: 3600,
    });

    const access = await store.get_access_token("github");
    expect(access).toBe("gho_test_token_12345");

    const refresh = await store.get_refresh_token("github");
    expect(refresh).toBe("ghr_refresh_67890");
  });

  it("토큰 재시작 후 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oauth-token-restart-"));
    cleanup_dirs.push(dir);
    const vault1 = new SecretVaultService(dir);
    await vault1.ensure_ready();
    const store1 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault1);
    store1.upsert(make_integration({ instance_id: "github" }));
    await store1.set_tokens("github", { access_token: "persisted_token" });

    const vault2 = new SecretVaultService(dir);
    await vault2.ensure_ready();
    const store2 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault2);
    const access = await store2.get_access_token("github");
    expect(access).toBe("persisted_token");
  });

  it("remove → 연동 삭제 확인", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "to-delete" }));
    const removed = store.remove("to-delete");
    expect(removed).toBe(true);
    expect(store.get("to-delete")).toBeNull();
  });

  it("존재하지 않는 instance_id get은 null", async () => {
    const { store } = await make_env();
    expect(store.get("nonexistent")).toBeNull();
  });

  it("update_settings로 부분 업데이트", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "partial", label: "Before", enabled: true }));

    const updated = store.update_settings("partial", { label: "After", enabled: false });
    expect(updated).toBe(true);

    const got = store.get("partial");
    expect(got!.label).toBe("After");
    expect(got!.enabled).toBe(false);
  });

  it("커스텀 프리셋 저장 → 복원", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oauth-preset-"));
    cleanup_dirs.push(dir);
    const vault1 = new SecretVaultService(dir);
    await vault1.ensure_ready();
    const store1 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault1);
    store1.save_preset({
      service_type: "custom-api",
      label: "Custom API",
      auth_url: "https://custom.com/auth",
      token_url: "https://custom.com/token",
      scopes_available: ["read", "write"],
      default_scopes: ["read"],
      supports_refresh: true,
      extra_auth_params: {},
    });

    // 재시작
    const vault2 = new SecretVaultService(dir);
    await vault2.ensure_ready();
    const store2 = new OAuthIntegrationStore(join(dir, "oauth.db"), vault2);
    const presets = store2.load_presets();
    expect(presets).toHaveLength(1);
    expect(presets[0].service_type).toBe("custom-api");
    expect(presets[0].scopes_available).toEqual(["read", "write"]);
  });

  it("client credentials SecretVault 연동", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "oauth-client" }));

    await store.set_client_credentials("oauth-client", "client_id_123", "client_secret_456");

    const cid = await store.get_client_id("oauth-client");
    const csecret = await store.get_client_secret("oauth-client");
    expect(cid).toBe("client_id_123");
    expect(csecret).toBe("client_secret_456");
  });

  it("remove_tokens로 토큰 + 만료일 삭제", async () => {
    const { store } = await make_env();
    store.upsert(make_integration({ instance_id: "cleanup" }));
    await store.set_tokens("cleanup", { access_token: "temp_token", expires_in: 3600 });

    await store.remove_tokens("cleanup");

    const access = await store.get_access_token("cleanup");
    expect(access).toBeNull();
    expect(store.is_expired("cleanup")).toBe(false);
  });
});
