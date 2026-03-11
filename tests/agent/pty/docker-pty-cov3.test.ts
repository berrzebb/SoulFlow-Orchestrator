/**
 * docker-pty.ts — 미커버 분기 (cov3):
 * - L160: onExit(cb) — exited=false → return { dispose: () => exit_listeners.delete(cb) }
 *   → dispose() 호출 시 cb가 listeners에서 제거됨
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@src/agent/pty/tool-bridge-config.js", () => ({
  BRIDGE_SOCKET_CONTAINER_DIR: "/sf/bridge",
  BRIDGE_SCRIPT_CONTAINER_PATH: "/sf/bridge.sh",
  BRIDGE_MCP_CONFIG_CONTAINER_PATH: "/sf/mcp.json",
}));

vi.mock("@src/utils/common.js", () => ({
  swallow: vi.fn(),
  error_message: (e: unknown) => String(e),
}));

import { DockerPty } from "@src/agent/pty/docker-pty.js";

function make_stdout_emitter() {
  const emitter = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  (emitter as any).setEncoding = vi.fn().mockReturnThis();
  return emitter;
}

function make_docker() {
  const stdout_emitter = make_stdout_emitter();
  const stdin_mock = { write: vi.fn(), end: vi.fn() };
  return {
    docker: {
      create: vi.fn().mockResolvedValue("container-1"),
      start: vi.fn().mockResolvedValue(undefined),
      attach: vi.fn().mockResolvedValue({ stdin: stdin_mock, stdout: stdout_emitter }),
      kill: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    },
    stdout: stdout_emitter,
    stdin: stdin_mock,
  };
}

async function wait_init() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ── L160: onExit dispose → exit_listeners.delete(cb) ─────────────────────

describe("DockerPty — L160: onExit dispose → exit_listeners에서 제거", () => {
  it("onExit 반환 Disposable의 dispose() 호출 → cb 더 이상 호출 안 됨 (L160)", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], { name: "test", cwd: "/workspace", env: {} }, {
      docker, image: "node:22-slim",
    });
    await wait_init();

    const exit_cb = vi.fn();

    // exited=false → L160 path: exit_listeners.add(cb) + return { dispose: () => exit_listeners.delete(cb) }
    const { dispose } = pty.onExit(exit_cb);

    // dispose() 호출 → L160 dispose body: exit_listeners.delete(cb)
    dispose();

    // stdout close → emit_exit(0) → exit_listeners 순회 → cb는 이미 삭제되어 호출 안 됨
    stdout.emit("close");

    expect(exit_cb).not.toHaveBeenCalled();
  });

  it("dispose() 전에는 exit_cb가 정상 호출됨 (비교 확인)", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], { name: "test2", cwd: "/workspace", env: {} }, {
      docker, image: "node:22-slim",
    });
    await wait_init();

    const exit_cb = vi.fn();
    pty.onExit(exit_cb); // dispose 없이 등록만

    stdout.emit("close"); // emit_exit(0) → cb 호출
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 0 });
  });
});
