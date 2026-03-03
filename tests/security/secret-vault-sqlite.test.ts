import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { SecretVaultService } from "@src/security/secret-vault.ts";

describe("secret vault sqlite", () => {
  let workspace: string;
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  it("persists secrets in sqlite store and resolves values", async () => {
    workspace = await mkdtemp(join(tmpdir(), "sv-sqlite-"));
    const vault = new SecretVaultService(workspace);

    const saved = await vault.put_secret("Api Key", "test-secret-value-1234");
    expect(saved.ok).toBe(true);
    expect(saved.name).toBe("api_key");

    const names = await vault.list_names();
    expect(names).toEqual(["api_key"]);

    const cipher = await vault.get_secret_cipher("api_key");
    expect(String(cipher || "").startsWith("sv1.")).toBe(true);

    const plain = await vault.reveal_secret("api_key");
    expect(plain).toBe("test-secret-value-1234");

    const resolved = await vault.resolve_placeholders("token={{secret:api_key}}");
    expect(resolved.includes("test-secret-value-1234")).toBe(true);

    const paths = vault.get_paths();
    expect(String(paths.store_path || "").endsWith("secrets.db")).toBe(true);
  });
});
