/**
 * tool-bridge-config — 상수, config 생성, 임시 파일 쓰기/정리 테스트.
 */
import { describe, it, expect } from "vitest";
import {
  BRIDGE_SCRIPT_CONTAINER_PATH,
  BRIDGE_MCP_CONFIG_CONTAINER_PATH,
  BRIDGE_SOCKET_CONTAINER_DIR,
  BRIDGE_SOCKET_CONTAINER_PATH,
  create_bridge_mcp_config,
  write_bridge_mcp_config,
  cleanup_bridge_mcp_config,
} from "@src/agent/pty/tool-bridge-config.js";
import { existsSync, readFileSync } from "node:fs";

// ══════════════════════════════════════════
// 상수
// ══════════════════════════════════════════

describe("tool-bridge-config — 상수", () => {
  it("BRIDGE_SCRIPT_CONTAINER_PATH", () => {
    expect(BRIDGE_SCRIPT_CONTAINER_PATH).toBe("/usr/local/lib/bridge-mcp-server.mjs");
  });

  it("BRIDGE_MCP_CONFIG_CONTAINER_PATH", () => {
    expect(BRIDGE_MCP_CONFIG_CONTAINER_PATH).toBe("/etc/bridge-mcp.json");
  });

  it("BRIDGE_SOCKET_CONTAINER_DIR", () => {
    expect(BRIDGE_SOCKET_CONTAINER_DIR).toBe("/run/bridge");
  });

  it("BRIDGE_SOCKET_CONTAINER_PATH", () => {
    expect(BRIDGE_SOCKET_CONTAINER_PATH).toBe("/run/bridge/bridge.sock");
  });
});

// ══════════════════════════════════════════
// create_bridge_mcp_config
// ══════════════════════════════════════════

describe("create_bridge_mcp_config()", () => {
  it("mcpServers.orchestrator 포함", () => {
    const cfg = create_bridge_mcp_config();
    expect(cfg.mcpServers).toBeDefined();
    expect(cfg.mcpServers.orchestrator).toBeDefined();
    expect(cfg.mcpServers.orchestrator.command).toBe("node");
  });

  it("args에 BRIDGE_SCRIPT_CONTAINER_PATH 포함", () => {
    const cfg = create_bridge_mcp_config();
    expect(cfg.mcpServers.orchestrator.args).toContain(BRIDGE_SCRIPT_CONTAINER_PATH);
  });

  it("env.BRIDGE_SOCKET_PATH = BRIDGE_SOCKET_CONTAINER_PATH", () => {
    const cfg = create_bridge_mcp_config();
    expect(cfg.mcpServers.orchestrator.env?.BRIDGE_SOCKET_PATH).toBe(BRIDGE_SOCKET_CONTAINER_PATH);
  });
});

// ══════════════════════════════════════════
// write_bridge_mcp_config / cleanup
// ══════════════════════════════════════════

describe("write_bridge_mcp_config() / cleanup_bridge_mcp_config()", () => {
  it("임시 파일 생성 → JSON 파싱 가능", async () => {
    const { host_dir, host_path } = await write_bridge_mcp_config("test-session");
    try {
      expect(existsSync(host_path)).toBe(true);
      const content = readFileSync(host_path, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.orchestrator).toBeDefined();
    } finally {
      await cleanup_bridge_mcp_config(host_dir);
    }
  });

  it("cleanup_bridge_mcp_config → 디렉토리 삭제", async () => {
    const { host_dir } = await write_bridge_mcp_config("test-cleanup");
    await cleanup_bridge_mcp_config(host_dir);
    expect(existsSync(host_dir)).toBe(false);
  });

  it("cleanup_bridge_mcp_config — 이미 없는 경로 → 에러 없음", async () => {
    await expect(cleanup_bridge_mcp_config("/tmp/nonexistent-sf-test-12345")).resolves.not.toThrow();
  });
});
