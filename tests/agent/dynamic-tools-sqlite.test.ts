import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";
import { DynamicToolRuntimeLoader } from "@src/agent/tools/runtime-loader.ts";
import { SqliteDynamicToolStore } from "@src/agent/tools/store.ts";
import { with_sqlite } from "@src/utils/sqlite-helper.js";

// L31: normalize_entry catch — 잘못된 parameters_json → { type: "object" }
describe("SqliteDynamicToolStore — bad parameters_json catch (L31)", () => {
  it("잘못된 parameters_json → catch → { type: 'object' } (L31)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "store-bad-json-"));
    try {
      const store = new SqliteDynamicToolStore(ws);
      // 정상 도구 추가
      store.upsert_tool({ name: "test_tool", description: "test", enabled: true, kind: "shell", parameters: { type: "object" }, command_template: "echo test", requires_approval: false });
      // DB에서 parameters_json을 잘못된 JSON으로 교체
      with_sqlite(store.sqlite_path, (db) => {
        db.prepare("UPDATE dynamic_tools SET parameters_json = ? WHERE name = ?").run("{{{bad json", "test_tool");
      });
      const tools = store.list_tools();
      const tool = tools.find((t) => t.name === "test_tool");
      // 잘못된 JSON → catch → parameters = { type: "object" }
      expect(tool?.parameters).toEqual({ type: "object" });
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("dynamic tools sqlite", () => {
  let workspace: string;
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  it("installer/runtime loader use sqlite store", async () => {
    workspace = await mkdtemp(join(tmpdir(), "dynamic-tools-"));
    const installer = new ToolInstallerService(workspace);
    const loader = new DynamicToolRuntimeLoader(workspace);

    const before = loader.signature();
    const installed = await installer.install_shell_tool({
      name: "hello_tool",
      description: "echo hello",
      parameters: { type: "object", properties: {} },
      command_template: "echo hello",
      overwrite: true,
    });
    expect(installed.installed).toBe(true);

    const rows = await installer.list_tools();
    expect(rows.some((row) => row.name === "hello_tool")).toBe(true);
    const loaded = loader.load_tools();
    expect(loaded.some((tool) => tool.name === "hello_tool")).toBe(true);

    const after = loader.signature();
    expect(after).not.toBe(before);

    const removed = await installer.uninstall_tool("hello_tool");
    expect(removed).toBe(true);
    const loaded_after_remove = loader.load_tools();
    expect(loaded_after_remove.some((tool) => tool.name === "hello_tool")).toBe(false);
  });
});

// L21: normalize_entry — 빈 name → null
describe("SqliteDynamicToolStore — normalize_entry 빈 name (L21)", () => {
  it("빈 name 행 → normalize_entry null → list_tools에 포함 안 됨 (L21)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "store-empty-name-"));
    try {
      const store = new SqliteDynamicToolStore(ws);
      // 유효한 행 1개 삽입 (upsert_tool로)
      store.upsert_tool({ name: "valid_tool", description: "ok", enabled: true, kind: "shell", parameters: { type: "object" }, command_template: "echo x", requires_approval: false });
      // 빈 name 행 직접 삽입
      with_sqlite(store.sqlite_path, (db) => {
        db.prepare("INSERT INTO dynamic_tools (name, description, enabled, kind, parameters_json, command_template, working_dir, requires_approval, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("", "empty name", 1, "shell", "{}", "echo empty", null, 0, Date.now());
      });
      const tools = store.list_tools();
      // 빈 name 행은 normalize_entry(row) = null → 포함 안 됨
      expect(tools.some((t) => t.name === "")).toBe(false);
      expect(tools.some((t) => t.name === "valid_tool")).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// L23: normalize_entry — kind !== "shell" → null
describe("SqliteDynamicToolStore — normalize_entry non-shell kind (L23)", () => {
  it("kind='webhook' 행 → normalize_entry null → list_tools에 포함 안 됨 (L23)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "store-non-shell-"));
    try {
      const store = new SqliteDynamicToolStore(ws);
      // non-shell kind 직접 삽입
      with_sqlite(store.sqlite_path, (db) => {
        db.prepare("INSERT INTO dynamic_tools (name, description, enabled, kind, parameters_json, command_template, working_dir, requires_approval, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("webhook_tool", "webhook", 1, "webhook", "{}", "http://example.com", null, 0, Date.now());
      });
      const tools = store.list_tools();
      // kind="webhook" → normalize_entry null → 포함 안 됨
      expect(tools.some((t) => t.name === "webhook_tool")).toBe(false);
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// L67: remove_if_empty — 0바이트 파일 삭제
describe("SqliteDynamicToolStore — remove_if_empty 0바이트 파일 (L67)", () => {
  it("0바이트 DB 파일 → 생성자에서 삭제 후 초기화 (L67)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "store-empty-file-"));
    try {
      const db_path = join(ws, "runtime", "custom-tools", "tools.db");
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(ws, "runtime", "custom-tools"), { recursive: true });
      writeFileSync(db_path, ""); // 0바이트 파일 생성
      // 생성자가 0바이트 파일을 감지 → unlinkSync(L67) → 재초기화
      const store = new SqliteDynamicToolStore(ws);
      // 정상 초기화 확인
      const tools = store.list_tools();
      expect(Array.isArray(tools)).toBe(true);
    } finally {
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
});
