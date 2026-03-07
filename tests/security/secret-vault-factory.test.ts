import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { get_shared_secret_vault, set_default_vault_workspace } from "@src/security/secret-vault-factory.ts";
import { SecretVaultService } from "@src/security/secret-vault.ts";

describe("secret vault factory", () => {
  it("reuses instance per workspace path", async () => {
    const root = await mkdtemp(join(tmpdir(), "secret-vault-factory-"));
    const nested = join(root, ".");
    const other = await mkdtemp(join(tmpdir(), "secret-vault-factory-other-"));
    try {
      const a = get_shared_secret_vault(root);
      const b = get_shared_secret_vault(nested);
      const c = get_shared_secret_vault(other);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  });

  it("throws when no workspace provided and default not set", () => {
    expect(() => get_shared_secret_vault()).toThrow("workspace not set");
  });

  it("uses default workspace when set", async () => {
    const root = await mkdtemp(join(tmpdir(), "secret-vault-default-"));
    try {
      set_default_vault_workspace(root);
      const a = get_shared_secret_vault();
      const b = get_shared_secret_vault(root);
      expect(a).toBe(b);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("secret vault keyring migration", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sv-keyring-migration-"));
  });

  it("stores master key in keyring.db, not secrets.db", async () => {
    const vault = new SecretVaultService(workspace);
    await vault.put_secret("test_key", "test_value");

    const { existsSync } = await import("node:fs");
    const keyring_path = join(workspace, "runtime", "security", "keyring.db");
    expect(existsSync(keyring_path)).toBe(true);
  });

  it("encrypts and decrypts after keyring separation", async () => {
    const vault = new SecretVaultService(workspace);
    await vault.put_secret("my_api_key", "super-secret-123");
    const plain = await vault.reveal_secret("my_api_key");
    expect(plain).toBe("super-secret-123");
  });
});

describe("secret vault mask cache", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sv-mask-cache-"));
  });

  it("mask_known_secrets masks stored secret values", async () => {
    const vault = new SecretVaultService(workspace);
    await vault.put_secret("token", "my-secret-token-value");
    const masked = await vault.mask_known_secrets("The token is my-secret-token-value here");
    expect(masked).not.toContain("my-secret-token-value");
    expect(masked).toContain("[REDACTED:SECRET]");
  });

  it("invalidates cache on put_secret", async () => {
    const vault = new SecretVaultService(workspace);
    await vault.put_secret("key_a", "value-alpha-12345");
    // 캐시 생성
    await vault.mask_known_secrets("value-alpha-12345");

    // 새 시크릿 추가 → 캐시 무효화
    await vault.put_secret("key_b", "value-beta-67890");
    const masked = await vault.mask_known_secrets("value-alpha-12345 and value-beta-67890");
    expect(masked).not.toContain("value-alpha-12345");
    expect(masked).not.toContain("value-beta-67890");
  });

  it("invalidates cache on remove_secret", async () => {
    const vault = new SecretVaultService(workspace);
    await vault.put_secret("key_x", "value-x-secret");
    await vault.mask_known_secrets("value-x-secret");

    await vault.remove_secret("key_x");
    // 삭제 후 마스킹 불필요
    const masked = await vault.mask_known_secrets("value-x-secret");
    expect(masked).toContain("value-x-secret");
  });
});
