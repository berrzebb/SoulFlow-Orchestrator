import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { get_shared_secret_vault } from "@src/security/secret-vault-factory.ts";

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
});
