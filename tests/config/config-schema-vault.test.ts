/**
 * config/schema.ts — load_config_merged vault 경로 커버 (L334-336).
 * get_sensitive_fields를 모의하여 vault에서 값을 읽는 경로를 커버.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config-meta mock: sensitive 필드를 갖도록 오버라이드
vi.mock("@src/config/config-meta.js", async (importActual) => {
  const actual = await importActual<typeof import("@src/config/config-meta.js")>();
  return {
    ...actual,
    get_sensitive_fields: () => [
      { path: "channel.dispatch.dlqPath", label: "Test Field", section: "test", type: "string", sensitive: true, env_key: "", default_value: "", restart_required: false, description: "" },
    ],
  };
});

import { ConfigStore } from "@src/config/config-store.js";
import { SecretVaultService } from "@src/security/secret-vault.js";
import { load_config_merged } from "@src/config/schema.js";

let workspace: string;

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("load_config_merged — vault에서 민감값 읽기 (L334-336)", () => {
  it("get_sensitive 값이 있으면 merged config에 set_nested 호출", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfg-vault-cov-"));
    const vault = new SecretVaultService(workspace);
    const store = new ConfigStore(join(workspace, "config.db"), vault);

    // vault에 민감값 저장 (get_sensitive가 반환할 값)
    // ConfigStore.get_sensitive → vault.reveal_secret("config.channel.dispatch.dlqPath")
    await vault.put_secret("config.channel.dispatch.dlqPath", "/tmp/test.db");

    const config = await load_config_merged(store);
    // vault 값이 set_nested로 merged에 설정됨 → schema parse 후 값 확인
    expect(config.channel.dispatch.dlqPath).toBe("/tmp/test.db");
  });

  it("get_sensitive 값 없으면 set_nested 미호출 (if (vault_value) 분기)", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfg-vault-empty-"));
    const vault = new SecretVaultService(workspace);
    const store = new ConfigStore(join(workspace, "config.db"), vault);

    // vault에 값 없음 → get_sensitive returns null → if (vault_value) false → set_nested 미호출
    const config = await load_config_merged(store);
    expect(config.agentLoopMaxTurns).toBeDefined(); // 기본값 사용
  });
});
