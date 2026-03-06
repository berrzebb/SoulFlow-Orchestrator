/**
 * Tool Bridge MCP 설정 생성 — 컨테이너 CLI가 bridge-mcp-server.mjs에 연결하기 위한 설정 파일.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** 컨테이너 내부 경로 상수. */
export const BRIDGE_SCRIPT_CONTAINER_PATH = "/usr/local/lib/bridge-mcp-server.mjs";
export const BRIDGE_MCP_CONFIG_CONTAINER_PATH = "/etc/bridge-mcp.json";
export const BRIDGE_SOCKET_CONTAINER_DIR = "/run/bridge";
export const BRIDGE_SOCKET_CONTAINER_PATH = `${BRIDGE_SOCKET_CONTAINER_DIR}/bridge.sock`;

/** bridge-mcp-server.mjs의 호스트 경로. */
export const BRIDGE_SCRIPT_HOST_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "bridge-mcp-server.mjs",
);

export type BridgeMcpConfig = {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
};

/** MCP config JSON 생성. */
export function create_bridge_mcp_config(): BridgeMcpConfig {
  return {
    mcpServers: {
      orchestrator: {
        command: "node",
        args: [BRIDGE_SCRIPT_CONTAINER_PATH],
        env: { BRIDGE_SOCKET_PATH: BRIDGE_SOCKET_CONTAINER_PATH },
      },
    },
  };
}

/** MCP config를 임시 파일에 기록. 반환: 호스트 경로. */
export async function write_bridge_mcp_config(_session_key: string): Promise<{ host_dir: string; host_path: string }> {
  const host_dir = await mkdtemp(join(tmpdir(), `sf-mcp-cfg-`));
  const host_path = join(host_dir, "bridge-mcp.json");
  const config = create_bridge_mcp_config();
  await writeFile(host_path, JSON.stringify(config, null, 2));
  return { host_dir, host_path };
}

/** 임시 설정 디렉토리 정리. */
export async function cleanup_bridge_mcp_config(host_dir: string): Promise<void> {
  await rm(host_dir, { recursive: true, force: true }).catch(() => {});
}
