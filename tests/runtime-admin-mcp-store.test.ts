import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolInstallerService } from "../src/agent/tools/installer.ts";
import { RuntimeAdminTool } from "../src/agent/tools/runtime-admin.ts";

function parse_json(text: string): Record<string, unknown> {
  return JSON.parse(String(text || "{}")) as Record<string, unknown>;
}

test("runtime_admin manages mcp servers through mcp store interface", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "runtime-admin-mcp-"));
  const installer = new ToolInstallerService(workspace);
  const tool = new RuntimeAdminTool({ workspace, installer });

  const upsert_raw = await tool.execute({
    action: "mcp_upsert_server",
    mcp_server_name: "agentbrowser",
    mcp_command: "npx",
    mcp_args: ["-y", "@modelcontextprotocol/server-filesystem", workspace],
    mcp_env: { NODE_ENV: "production" },
    mcp_cwd: workspace,
    mcp_startup_timeout_sec: 15,
  });
  const upsert = parse_json(upsert_raw);
  assert.equal(upsert.ok, true);
  assert.equal(String(upsert.action || ""), "mcp_upsert_server");
  const file = String(upsert.file || "");
  assert.equal(file.endsWith(".mcp.json"), true);
  assert.equal(existsSync(file), true);

  const list_raw = await tool.execute({ action: "mcp_list" });
  const list = parse_json(list_raw);
  const row = list.agentbrowser as Record<string, unknown> | undefined;
  assert.equal(Boolean(row), true);
  assert.equal(String(row?.command || ""), "npx");
  assert.equal(Array.isArray(row?.args), true);
  assert.equal(String((row?.env as Record<string, unknown> | undefined)?.NODE_ENV || ""), "production");

  const remove_raw = await tool.execute({
    action: "mcp_remove_server",
    mcp_server_name: "agentbrowser",
  });
  const remove = parse_json(remove_raw);
  assert.equal(remove.ok, true);

  const list_after_raw = await tool.execute({ action: "mcp_list" });
  const list_after = parse_json(list_after_raw);
  assert.equal(Object.prototype.hasOwnProperty.call(list_after, "agentbrowser"), false);
});

