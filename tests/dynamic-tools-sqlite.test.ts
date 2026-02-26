import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolInstallerService } from "../src/agent/tools/installer.ts";
import { DynamicToolRuntimeLoader } from "../src/agent/tools/runtime-loader.ts";

test("dynamic tool installer/runtime loader use sqlite store", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dynamic-tools-"));
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
  assert.equal(installed.installed, true);

  const rows = await installer.list_tools();
  assert.equal(rows.some((row) => row.name === "hello_tool"), true);
  const loaded = loader.load_tools();
  assert.equal(loaded.some((tool) => tool.name === "hello_tool"), true);

  const after = loader.signature();
  assert.notEqual(after, before);

  const removed = await installer.uninstall_tool("hello_tool");
  assert.equal(removed, true);
  const loaded_after_remove = loader.load_tools();
  assert.equal(loaded_after_remove.some((tool) => tool.name === "hello_tool"), false);
});

