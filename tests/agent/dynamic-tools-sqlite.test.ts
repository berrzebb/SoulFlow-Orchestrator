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
