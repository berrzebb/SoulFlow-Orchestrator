import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";
import { DynamicToolRuntimeLoader } from "@src/agent/tools/runtime-loader.ts";

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
