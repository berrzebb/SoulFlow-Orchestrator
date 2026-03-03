import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVaultService } from "@src/security/secret-vault.js";
import { ChannelInstanceStore } from "@src/channels/instance-store.js";
import type { CreateChannelInstanceInput } from "@src/channels/instance-store.js";

describe("ChannelInstanceStore", () => {
  let workspace: string;

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  function make_input(patch: Partial<CreateChannelInstanceInput> = {}): CreateChannelInstanceInput {
    return {
      instance_id: patch.instance_id ?? "test_channel",
      provider: patch.provider ?? "slack",
      label: patch.label ?? "Test Channel",
      enabled: patch.enabled ?? true,
      settings: patch.settings ?? {},
    };
  }

  it("upsert → get → list → count CRUD 동작", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cs-crud-"));
    const vault = new SecretVaultService(workspace);
    const store = new ChannelInstanceStore(join(workspace, "channels.db"), vault);

    expect(store.count()).toBe(0);

    store.upsert(make_input({ instance_id: "slack", provider: "slack" }));
    store.upsert(make_input({ instance_id: "discord", provider: "discord" }));

    const slack = store.get("slack");
    expect(slack).not.toBeNull();
    expect(slack!.instance_id).toBe("slack");
    expect(slack!.provider).toBe("slack");

    const list = store.list();
    expect(list.length).toBe(2);
    expect(store.count()).toBe(2);
  });

  it("토큰 생명주기: set → has → get → remove → null", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cs-token-"));
    const vault = new SecretVaultService(workspace);
    const store = new ChannelInstanceStore(join(workspace, "channels.db"), vault);

    expect(await store.has_token("slack")).toBe(false);

    await store.set_token("slack", "xoxb-test-token-123");
    expect(await store.has_token("slack")).toBe(true);
    expect(await store.get_token("slack")).toBe("xoxb-test-token-123");

    await store.remove_token("slack");
    expect(await store.get_token("slack")).toBeNull();
  });

  it("remove — 인스턴스 삭제 + 존재하지 않는 id는 false 반환", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cs-remove-"));
    const vault = new SecretVaultService(workspace);
    const store = new ChannelInstanceStore(join(workspace, "channels.db"), vault);

    store.upsert(make_input({ instance_id: "to_delete" }));
    expect(store.remove("to_delete")).toBe(true);
    expect(store.get("to_delete")).toBeNull();
    expect(store.remove("nonexistent")).toBe(false);
  });

  it("update_settings — 기존 설정에 병합", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cs-upd-"));
    const vault = new SecretVaultService(workspace);
    const store = new ChannelInstanceStore(join(workspace, "channels.db"), vault);

    store.upsert(make_input({
      instance_id: "slack",
      settings: { default_channel: "general", bot_self_id: "U123" },
    }));

    store.update_settings("slack", { settings: { default_channel: "random" } });

    const updated = store.get("slack")!;
    expect(updated.settings.default_channel).toBe("random");
    expect(updated.settings.bot_self_id).toBe("U123");
  });
});
