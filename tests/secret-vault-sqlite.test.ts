import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SecretVaultService } from "../src/security/secret-vault.ts";

test("secret vault persists secrets in sqlite store and resolves values", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sv-sqlite-"));
  const vault = new SecretVaultService(workspace);

  const saved = await vault.put_secret("Api Key", "test-secret-value-1234");
  assert.equal(saved.ok, true);
  assert.equal(saved.name, "api_key");

  const names = await vault.list_names();
  assert.deepEqual(names, ["api_key"]);

  const cipher = await vault.get_secret_cipher("api_key");
  assert.equal(String(cipher || "").startsWith("sv1."), true);

  const plain = await vault.reveal_secret("api_key");
  assert.equal(plain, "test-secret-value-1234");

  const resolved = await vault.resolve_placeholders("token={{secret:api_key}}");
  assert.equal(resolved.includes("test-secret-value-1234"), true);

  const paths = vault.get_paths();
  assert.equal(String(paths.store_path || "").endsWith("secrets.db"), true);
});

