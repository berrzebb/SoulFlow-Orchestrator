import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AdminStore } from "@src/auth/admin-store.js";
import { SharedProviderAdapter } from "@src/auth/shared-provider-adapter.js";
import type { SecretVaultLike } from "@src/security/secret-vault.js";

function make_vault(key_map: Record<string, string> = {}): SecretVaultLike {
  return {
    reveal_secret: vi.fn(async (key: string) => key_map[key] ?? null),
    put_secret: vi.fn(),
    remove_secret: vi.fn(),
    get_secret_cipher: vi.fn(),
  } as unknown as SecretVaultLike;
}

function make_adapter(providers: {
  name: string; type: string; model: string; config?: Record<string, unknown>;
  api_key_ref: string; enabled?: boolean;
}[], vault: SecretVaultLike) {
  const path = join(tmpdir(), `shared-prov-test-${randomUUID()}.db`);
  const store = new AdminStore(path);
  providers.forEach((p) =>
    store.create_shared_provider({
      name: p.name, type: p.type, model: p.model,
      config: p.config ?? {}, api_key_ref: p.api_key_ref, enabled: p.enabled ?? true,
    })
  );
  return { adapter: new SharedProviderAdapter(store, vault), store };
}

describe("SharedProviderAdapter — list()", () => {
  it("활성 공유 프로바이더를 AgentProviderConfig 형식으로 반환", () => {
    const { adapter } = make_adapter([
      { name: "Shared OpenAI", type: "openai", model: "gpt-4o", api_key_ref: "k1", enabled: true },
    ], make_vault());

    const list = adapter.list();
    expect(list.length).toBe(1);
    expect(list[0].label).toBe("Shared OpenAI");
    expect(list[0].provider_type).toBe("openai");
    expect(list[0].instance_id.startsWith("shared:")).toBe(true);
  });

  it("비활성 공유 프로바이더는 목록에서 제외", () => {
    const { adapter } = make_adapter([
      { name: "Active", type: "openai", model: "m", api_key_ref: "k1", enabled: true },
      { name: "Inactive", type: "anthropic", model: "m", api_key_ref: "k2", enabled: false },
    ], make_vault());

    expect(adapter.list().length).toBe(1);
    expect(adapter.list()[0].label).toBe("Active");
  });

  it("빈 admin.db → 빈 배열", () => {
    const { adapter } = make_adapter([], make_vault());
    expect(adapter.list()).toEqual([]);
  });

  it("settings에 model 포함됨", () => {
    const { adapter } = make_adapter([
      { name: "X", type: "openai", model: "gpt-4-turbo", config: { base_url: "https://api.example.com" }, api_key_ref: "k" },
    ], make_vault());

    const cfg = adapter.list()[0];
    expect(cfg.settings.model).toBe("gpt-4-turbo");
    expect(cfg.settings.base_url).toBe("https://api.example.com");
  });

  it("priority = 1000 (개인 프로바이더보다 낮음)", () => {
    const { adapter } = make_adapter([
      { name: "Y", type: "openai", model: "m", api_key_ref: "k" },
    ], make_vault());
    expect(adapter.list()[0].priority).toBe(1000);
  });
});

describe("SharedProviderAdapter — get_api_key()", () => {
  it("올바른 shared instance_id → vault에서 키 반환", async () => {
    const vault = make_vault();
    const { adapter, store } = make_adapter([
      { name: "Z", type: "openai", model: "m", api_key_ref: "vault.shared.openai.key" },
    ], vault);

    const config = adapter.list()[0];
    await adapter.get_api_key(config.instance_id);
    expect(vault.reveal_secret).toHaveBeenCalledWith("vault.shared.openai.key");
  });

  it("비공유 instance_id (접두사 없음) → null", async () => {
    const { adapter } = make_adapter([], make_vault());
    expect(await adapter.get_api_key("personal:abc")).toBeNull();
  });

  it("존재하지 않는 shared instance_id → null", async () => {
    const vault = make_vault();
    const { adapter } = make_adapter([], vault);
    expect(await adapter.get_api_key("shared:nonexistent-uuid")).toBeNull();
  });
});

describe("SharedProviderAdapter — is_shared() 정적 메서드", () => {
  it("'shared:' 접두사 → true", () => {
    expect(SharedProviderAdapter.is_shared("shared:abc123")).toBe(true);
  });

  it("접두사 없음 → false", () => {
    expect(SharedProviderAdapter.is_shared("personal:abc")).toBe(false);
    expect(SharedProviderAdapter.is_shared("openai")).toBe(false);
  });
});
