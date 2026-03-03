import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVaultService } from "@src/security/secret-vault.js";
import { AgentProviderStore } from "@src/agent/provider-store.js";
import type { CreateAgentProviderInput } from "@src/agent/agent.types.js";

describe("AgentProviderStore", () => {
  let workspace: string;

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  function make_input(patch: Partial<CreateAgentProviderInput> = {}): CreateAgentProviderInput {
    return {
      instance_id: patch.instance_id ?? "test_provider",
      provider_type: patch.provider_type ?? "claude_cli",
      label: patch.label ?? "Test Provider",
      enabled: patch.enabled ?? true,
      priority: patch.priority ?? 50,
      supported_modes: patch.supported_modes ?? ["once", "agent", "task"],
      settings: patch.settings ?? {},
    };
  }

  it("upsert → get → list → count CRUD 동작", async () => {
    workspace = await mkdtemp(join(tmpdir(), "ps-crud-"));
    const vault = new SecretVaultService(workspace);
    const store = new AgentProviderStore(join(workspace, "providers.db"), vault);

    expect(store.count()).toBe(0);

    store.upsert(make_input({ instance_id: "a", priority: 10 }));
    store.upsert(make_input({ instance_id: "b", priority: 20 }));

    const a = store.get("a");
    expect(a).not.toBeNull();
    expect(a!.instance_id).toBe("a");
    expect(a!.priority).toBe(10);
    expect(a!.enabled).toBe(true);

    const list = store.list();
    expect(list.length).toBe(2);
    expect(list[0].instance_id).toBe("a");
    expect(list[1].instance_id).toBe("b");
    expect(store.count()).toBe(2);
  });

  it("토큰 생명주기: set → has → get → remove → null", async () => {
    workspace = await mkdtemp(join(tmpdir(), "ps-token-"));
    const vault = new SecretVaultService(workspace);
    const store = new AgentProviderStore(join(workspace, "providers.db"), vault);

    expect(await store.has_token("openrouter")).toBe(false);

    await store.set_token("openrouter", "sk-or-test-12345");
    expect(await store.has_token("openrouter")).toBe(true);
    expect(await store.get_token("openrouter")).toBe("sk-or-test-12345");

    await store.remove_token("openrouter");
    expect(await store.get_token("openrouter")).toBeNull();
    expect(await store.has_token("openrouter")).toBe(false);
  });
});
