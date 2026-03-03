import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, it, expect } from "vitest";
import { ToolInstallerService } from "@src/agent/tools/installer.ts";
import { RuntimeAdminTool } from "@src/agent/tools/runtime-admin.ts";

function parse_json(text: string): Record<string, unknown> {
  return JSON.parse(String(text || "{}")) as Record<string, unknown>;
}

describe("runtime admin mcp store", () => {
  let workspace: string;
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  it("manages mcp servers through mcp store interface", async () => {
    workspace = await mkdtemp(join(tmpdir(), "runtime-admin-mcp-"));
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
    expect(upsert.ok).toBe(true);
    expect(String(upsert.action || "")).toBe("mcp_upsert_server");
    const file = String(upsert.file || "");
    expect(file.endsWith(".mcp.json")).toBe(true);
    expect(existsSync(file)).toBe(true);

    const list_raw = await tool.execute({ action: "mcp_list" });
    const list = parse_json(list_raw);
    const row = list.agentbrowser as Record<string, unknown> | undefined;
    expect(Boolean(row)).toBe(true);
    expect(String(row?.command || "")).toBe("npx");
    expect(Array.isArray(row?.args)).toBe(true);
    expect(String((row?.env as Record<string, unknown> | undefined)?.NODE_ENV || "")).toBe("production");

    const remove_raw = await tool.execute({
      action: "mcp_remove_server",
      mcp_server_name: "agentbrowser",
    });
    const remove = parse_json(remove_raw);
    expect(remove.ok).toBe(true);

    const list_after_raw = await tool.execute({ action: "mcp_list" });
    const list_after = parse_json(list_after_raw);
    expect(Object.prototype.hasOwnProperty.call(list_after, "agentbrowser")).toBe(false);
  });
});
