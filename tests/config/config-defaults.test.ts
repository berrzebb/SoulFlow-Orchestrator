import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVaultService } from "@src/security/secret-vault.js";
import { AppConfigSchema, get_config_defaults, load_config_merged, set_nested } from "@src/config/schema.js";
import { ConfigStore } from "@src/config/config-store.js";

describe("get_config_defaults", () => {
  it("AppConfigSchema를 충족하고 핵심 기본값이 올바르다", () => {
    const defaults = get_config_defaults();
    expect(AppConfigSchema.safeParse(defaults).success).toBe(true);

    expect(defaults.agentLoopMaxTurns).toBe(20);
    expect(defaults.channel.streaming.enabled).toBe(true);
    expect(defaults.orchestration.executorProvider).toBe("chatgpt");
    expect(defaults.orchestratorLlm.enabled).toBe(false);
    expect(defaults.orchestratorLlm.port).toBe(11434);
  });
});

describe("set_nested", () => {
  it("단일 레벨 경로 설정", () => {
    const obj: Record<string, unknown> = { a: 1 };
    set_nested(obj, "b", 2);
    expect(obj.b).toBe(2);
  });

  it("중첩 경로 설정 — 중간 객체 자동 생성", () => {
    const obj: Record<string, unknown> = {};
    set_nested(obj, "a.b.c", 42);
    expect((obj.a as Record<string, unknown>).b).toEqual({ c: 42 });
  });

  it("기존 값 덮어쓰기", () => {
    const obj: Record<string, unknown> = { x: { y: 1 } };
    set_nested(obj, "x.y", 99);
    expect((obj.x as Record<string, unknown>).y).toBe(99);
  });
});

describe("load_config_merged", () => {
  let workspace: string;

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("오버라이드 없으면 기본값 반환", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfg-noov-"));
    const vault = new SecretVaultService(workspace);
    const store = new ConfigStore(join(workspace, "config.db"), vault);

    const config = await load_config_merged(store);
    const defaults = get_config_defaults();
    expect(config.agentLoopMaxTurns).toBe(defaults.agentLoopMaxTurns);
    expect(config.channel.streaming.enabled).toBe(defaults.channel.streaming.enabled);
  });

  it("스토어 오버라이드가 기본값을 덮어쓴다", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfg-ov-"));
    const vault = new SecretVaultService(workspace);
    const store = new ConfigStore(join(workspace, "config.db"), vault);

    store.set_override("agentLoopMaxTurns", 99);

    const config = await load_config_merged(store);
    expect(config.agentLoopMaxTurns).toBe(99);
  });

  it("중첩 경로 오버라이드 (channel.streaming.intervalMs)", async () => {
    workspace = await mkdtemp(join(tmpdir(), "cfg-nested-"));
    const vault = new SecretVaultService(workspace);
    const store = new ConfigStore(join(workspace, "config.db"), vault);

    store.set_override("channel.streaming.intervalMs", 3000);

    const config = await load_config_merged(store);
    expect(config.channel.streaming.intervalMs).toBe(3000);
  });
});

