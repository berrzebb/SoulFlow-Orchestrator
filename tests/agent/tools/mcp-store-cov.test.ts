/**
 * FileMcpServerStore — 미커버 분기:
 * - L61: read_root() — JSON 파싱 결과가 객체가 아님 → not_json_object
 * - L64: read_root() — catch 블록 → invalid_mcp_json 재throw
 * - L91: upsert_server() — 빈 이름 → invalid_mcp_server_name
 * - L98-99: upsert_server() — mcp_servers 키 존재 시 삭제
 * - L106: remove_server() — 빈 이름 → false
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMcpServerStore } from "@src/agent/tools/mcp-store.js";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mcp-store-cov-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("FileMcpServerStore — read_root 오류 분기", () => {
  it("배열 JSON → not_json_object → invalid_mcp_json throw (L61, L64)", async () => {
    const file = join(workspace, "array.mcp.json");
    await writeFile(file, "[1, 2, 3]", "utf-8");
    const store = new FileMcpServerStore(workspace, file);
    await expect(store.list_servers()).rejects.toThrow("invalid_mcp_json");
  });

  it("잘못된 JSON → parse 실패 → invalid_mcp_json throw (L64)", async () => {
    const file = join(workspace, "bad.mcp.json");
    await writeFile(file, "{invalid json here", "utf-8");
    const store = new FileMcpServerStore(workspace, file);
    await expect(store.list_servers()).rejects.toThrow("invalid_mcp_json");
  });
});

describe("FileMcpServerStore — upsert_server 오류 분기", () => {
  it("빈 이름 → invalid_mcp_server_name throw (L91)", async () => {
    const store = new FileMcpServerStore(workspace);
    await expect(store.upsert_server("", { command: "test" })).rejects.toThrow("invalid_mcp_server_name");
  });

  it("공백만 이름 → invalid_mcp_server_name throw (L91)", async () => {
    const store = new FileMcpServerStore(workspace);
    await expect(store.upsert_server("   ", { command: "test" })).rejects.toThrow("invalid_mcp_server_name");
  });

  it("mcp_servers에 동일 키 존재 시 삭제 후 mcpServers로 이동 (L98-99)", async () => {
    const file = join(workspace, "snake.mcp.json");
    // mcp_servers에 "myserver" 키 존재
    await writeFile(
      file,
      JSON.stringify({ mcp_servers: { myserver: { command: "old-cmd" } } }),
      "utf-8",
    );
    const store = new FileMcpServerStore(workspace, file);
    await store.upsert_server("myserver", { command: "new-cmd" });
    const servers = await store.list_servers();
    expect(servers["myserver"]?.command).toBe("new-cmd");
  });
});

describe("FileMcpServerStore — remove_server 빈 이름 (L106)", () => {
  it("빈 이름 → false 반환", async () => {
    const store = new FileMcpServerStore(workspace);
    const result = await store.remove_server("");
    expect(result).toBe(false);
  });

  it("공백만 이름 → false 반환", async () => {
    const store = new FileMcpServerStore(workspace);
    const result = await store.remove_server("   ");
    expect(result).toBe(false);
  });
});
