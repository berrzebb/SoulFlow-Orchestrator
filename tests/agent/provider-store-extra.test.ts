/**
 * AgentProviderStore — 누락된 메서드 커버리지 확장.
 * list_for_mode, list_for_purpose, update_settings, remove,
 * resolve_token, resolve_api_base, has_resolved_token,
 * Connection CRUD, Connection 토큰.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVaultService } from "@src/security/secret-vault.js";
import { AgentProviderStore } from "@src/agent/provider-store.js";
import type { CreateAgentProviderInput, CreateProviderConnectionInput } from "@src/agent/agent.types.js";

let tmp_dir: string;
let store: AgentProviderStore;
let vault: SecretVaultService;

function make_provider(patch: Partial<CreateAgentProviderInput> = {}): CreateAgentProviderInput {
  return {
    instance_id: patch.instance_id ?? "prov1",
    provider_type: patch.provider_type ?? "claude_cli",
    label: patch.label ?? "Label",
    enabled: patch.enabled ?? true,
    priority: patch.priority ?? 50,
    model_purpose: patch.model_purpose ?? "chat",
    supported_modes: patch.supported_modes ?? ["once", "agent", "task"],
    settings: patch.settings ?? {},
    connection_id: patch.connection_id,
  };
}

function make_connection(patch: Partial<CreateProviderConnectionInput> = {}): CreateProviderConnectionInput {
  return {
    connection_id: patch.connection_id ?? "conn1",
    provider_type: patch.provider_type ?? "openai",
    label: patch.label ?? "OpenAI",
    enabled: patch.enabled ?? true,
    api_base: patch.api_base,
  };
}

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "ps-extra-"));
  vault = new SecretVaultService(tmp_dir);
  store = new AgentProviderStore(join(tmp_dir, "providers.db"), vault);
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ── list_for_mode ──

describe("AgentProviderStore — list_for_mode", () => {
  it("해당 mode를 지원하는 enabled 프로바이더만 반환", () => {
    store.upsert(make_provider({ instance_id: "a", supported_modes: ["once", "agent"] }));
    store.upsert(make_provider({ instance_id: "b", supported_modes: ["task"] }));
    store.upsert(make_provider({ instance_id: "c", supported_modes: ["once"] }));

    const result = store.list_for_mode("once");
    const ids = result.map((r) => r.instance_id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("disabled 프로바이더 제외", () => {
    store.upsert(make_provider({ instance_id: "on", enabled: true, supported_modes: ["once"] }));
    store.upsert(make_provider({ instance_id: "off", enabled: false, supported_modes: ["once"] }));

    const result = store.list_for_mode("once");
    expect(result.map((r) => r.instance_id)).not.toContain("off");
  });

  it("supported_modes 빈 배열 → 모든 mode에 포함", () => {
    store.upsert(make_provider({ instance_id: "all", supported_modes: [] }));
    expect(store.list_for_mode("task").map((r) => r.instance_id)).toContain("all");
    expect(store.list_for_mode("phase").map((r) => r.instance_id)).toContain("all");
  });
});

// ── list_for_purpose ──

describe("AgentProviderStore — list_for_purpose", () => {
  it("embedding 용도만 필터", () => {
    store.upsert(make_provider({ instance_id: "chat1", model_purpose: "chat" }));
    store.upsert(make_provider({ instance_id: "emb1", model_purpose: "embedding" }));

    const emb = store.list_for_purpose("embedding");
    expect(emb.map((r) => r.instance_id)).toContain("emb1");
    expect(emb.map((r) => r.instance_id)).not.toContain("chat1");
  });

  it("disabled 프로바이더 제외", () => {
    store.upsert(make_provider({ instance_id: "emb_on", model_purpose: "embedding", enabled: true }));
    store.upsert(make_provider({ instance_id: "emb_off", model_purpose: "embedding", enabled: false }));

    const result = store.list_for_purpose("embedding");
    expect(result.map((r) => r.instance_id)).not.toContain("emb_off");
  });
});

// ── update_settings ──

describe("AgentProviderStore — update_settings", () => {
  it("label 부분 업데이트", () => {
    store.upsert(make_provider({ instance_id: "p1", label: "Old" }));
    const ok = store.update_settings("p1", { label: "New" });
    expect(ok).toBe(true);
    expect(store.get("p1")!.label).toBe("New");
  });

  it("enabled 토글", () => {
    store.upsert(make_provider({ instance_id: "p1", enabled: true }));
    store.update_settings("p1", { enabled: false });
    expect(store.get("p1")!.enabled).toBe(false);
  });

  it("settings 머지", () => {
    store.upsert(make_provider({ instance_id: "p1", settings: { model: "gpt-4" } }));
    store.update_settings("p1", { settings: { temperature: 0.5 } });
    const s = store.get("p1")!.settings;
    expect(s.model).toBe("gpt-4");
    expect(s.temperature).toBe(0.5);
  });

  it("존재하지 않는 인스턴스 → false", () => {
    expect(store.update_settings("ghost", { label: "X" })).toBe(false);
  });
});

// ── remove ──

describe("AgentProviderStore — remove", () => {
  it("존재하는 인스턴스 삭제 → true", () => {
    store.upsert(make_provider({ instance_id: "del1" }));
    expect(store.remove("del1")).toBe(true);
    expect(store.get("del1")).toBeNull();
  });

  it("없는 인스턴스 삭제 → false", () => {
    expect(store.remove("ghost")).toBe(false);
  });
});

// ── resolve_token / resolve_api_base / has_resolved_token ──

describe("AgentProviderStore — resolve_token / resolve_api_base", () => {
  it("connection_id 없으면 인스턴스 자체 토큰 반환", async () => {
    store.upsert(make_provider({ instance_id: "p1" }));
    await store.set_token("p1", "my-token");
    expect(await store.resolve_token("p1")).toBe("my-token");
  });

  it("존재하지 않는 인스턴스 → null", async () => {
    expect(await store.resolve_token("ghost")).toBeNull();
  });

  it("connection_id 연결 시 connection 토큰 우선", async () => {
    store.upsert_connection(make_connection({ connection_id: "c1" }));
    await store.set_connection_token("c1", "conn-token");
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1" }));
    await store.set_token("p1", "instance-token");

    expect(await store.resolve_token("p1")).toBe("conn-token");
  });

  it("connection 토큰 없으면 인스턴스 토큰 폴백", async () => {
    store.upsert_connection(make_connection({ connection_id: "c1" }));
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1" }));
    await store.set_token("p1", "instance-token");

    expect(await store.resolve_token("p1")).toBe("instance-token");
  });

  it("resolve_api_base: connection의 api_base 우선", () => {
    store.upsert_connection(make_connection({ connection_id: "c1", api_base: "https://conn.example.com/v1" }));
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1", settings: { api_base: "https://instance.example.com" } }));

    expect(store.resolve_api_base("p1")).toBe("https://conn.example.com/v1");
  });

  it("resolve_api_base: connection 없으면 settings.api_base 반환", () => {
    store.upsert(make_provider({ instance_id: "p1", settings: { api_base: "https://instance.example.com" } }));
    expect(store.resolve_api_base("p1")).toBe("https://instance.example.com");
  });

  it("resolve_api_base: 존재하지 않는 인스턴스 → undefined", () => {
    expect(store.resolve_api_base("ghost")).toBeUndefined();
  });

  it("has_resolved_token: connection 토큰 있을 때 true", async () => {
    store.upsert_connection(make_connection({ connection_id: "c1" }));
    await store.set_connection_token("c1", "tok");
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1" }));
    expect(await store.has_resolved_token("p1")).toBe(true);
  });

  it("has_resolved_token: 존재하지 않는 인스턴스 → false", async () => {
    expect(await store.has_resolved_token("ghost")).toBe(false);
  });
});

// ── Connection CRUD ──

describe("AgentProviderStore — Connection CRUD", () => {
  it("upsert_connection → get_connection → list_connections", () => {
    store.upsert_connection(make_connection({ connection_id: "c1", label: "First" }));
    store.upsert_connection(make_connection({ connection_id: "c2", label: "Second" }));

    const c1 = store.get_connection("c1");
    expect(c1).not.toBeNull();
    expect(c1!.label).toBe("First");
    expect(c1!.provider_type).toBe("openai");

    const list = store.list_connections();
    expect(list.length).toBe(2);
  });

  it("get_connection: 없는 ID → null", () => {
    expect(store.get_connection("ghost")).toBeNull();
  });

  it("update_connection: label + enabled 업데이트", () => {
    store.upsert_connection(make_connection({ connection_id: "c1", label: "Old", enabled: true }));
    const ok = store.update_connection("c1", { label: "New", enabled: false });
    expect(ok).toBe(true);
    const conn = store.get_connection("c1");
    expect(conn!.label).toBe("New");
    expect(conn!.enabled).toBe(false);
  });

  it("update_connection: 없는 ID → false", () => {
    expect(store.update_connection("ghost", { label: "X" })).toBe(false);
  });

  it("remove_connection: 삭제 + 참조 provider null 초기화", () => {
    store.upsert_connection(make_connection({ connection_id: "c1" }));
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1" }));

    const ok = store.remove_connection("c1");
    expect(ok).toBe(true);
    expect(store.get_connection("c1")).toBeNull();
    // provider의 connection_id는 null로 초기화됨
    expect(store.get("p1")!.connection_id).toBeUndefined();
  });

  it("remove_connection: 없는 ID → false", () => {
    expect(store.remove_connection("ghost")).toBe(false);
  });

  it("count_presets_for_connection", () => {
    store.upsert_connection(make_connection({ connection_id: "c1" }));
    store.upsert(make_provider({ instance_id: "p1", connection_id: "c1" }));
    store.upsert(make_provider({ instance_id: "p2", connection_id: "c1" }));
    store.upsert(make_provider({ instance_id: "p3" }));

    expect(store.count_presets_for_connection("c1")).toBe(2);
    expect(store.count_presets_for_connection("ghost")).toBe(0);
  });
});

// ── Connection 토큰 ──

describe("AgentProviderStore — Connection 토큰", () => {
  it("set → has → get → remove 생명주기", async () => {
    expect(await store.has_connection_token("c1")).toBe(false);

    await store.set_connection_token("c1", "conn-secret");
    expect(await store.has_connection_token("c1")).toBe(true);
    expect(await store.get_connection_token("c1")).toBe("conn-secret");

    await store.remove_connection_token("c1");
    expect(await store.has_connection_token("c1")).toBe(false);
    expect(await store.get_connection_token("c1")).toBeNull();
  });
});
