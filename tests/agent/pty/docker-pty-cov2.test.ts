/**
 * DockerPty — 미커버 분기 커버리지.
 * - write: exited=true, !ready(buffer), ready+stdin
 * - end: exited=true, !ready(buffer+EOT), ready
 * - onExit: exited=true → immediate cb
 * - kill: 정상 흐름
 * - init: 오류 → emit_exit(1)
 * - wire_stdout: close/error 이벤트
 * - build_volumes: bridge 포함/미포함
 * - create_docker_pty_factory: 팩토리 생성
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── tool-bridge-config mock ─────────────────────────────────────────────────

vi.mock("@src/agent/pty/tool-bridge-config.js", () => ({
  BRIDGE_SOCKET_CONTAINER_DIR: "/sf/bridge",
  BRIDGE_SCRIPT_CONTAINER_PATH: "/sf/bridge.sh",
  BRIDGE_MCP_CONFIG_CONTAINER_PATH: "/sf/mcp.json",
}));

vi.mock("@src/utils/common.js", () => ({
  swallow: vi.fn(),
  error_message: (e: unknown) => String(e),
}));

import { DockerPty, create_docker_pty_factory } from "@src/agent/pty/docker-pty.js";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function make_stdout_emitter() {
  const emitter = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  (emitter as any).setEncoding = vi.fn().mockReturnThis();
  return emitter;
}

function make_stdin_mock() {
  return {
    write: vi.fn(),
    end: vi.fn(),
  };
}

function make_docker(overrides: Partial<{
  create: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  rm: ReturnType<typeof vi.fn>;
}> = {}) {
  const stdout_emitter = make_stdout_emitter();
  const stdin_mock = make_stdin_mock();
  return {
    docker: {
      create: vi.fn().mockResolvedValue("container-1"),
      start: vi.fn().mockResolvedValue(undefined),
      attach: vi.fn().mockResolvedValue({ stdin: stdin_mock, stdout: stdout_emitter }),
      kill: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    stdout: stdout_emitter,
    stdin: stdin_mock,
  };
}

function make_spawn_options(name = "test-session") {
  return { name, cwd: "/workspace", env: {} };
}

function make_pty_opts(docker: ReturnType<typeof make_docker>["docker"], bridge?: boolean) {
  return {
    docker,
    image: "node:22-slim",
    bridge: bridge ? { socket_dir: "/host/socket", script_path: "/host/bridge.sh", mcp_config_path: "/host/mcp.json" } : undefined,
  };
}

// init()은 비동기, 완료 대기 헬퍼
async function wait_init() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ══════════════════════════════════════════════════════════
// 기본 초기화
// ══════════════════════════════════════════════════════════

describe("DockerPty — 기본 초기화", () => {
  it("init 성공 → ready=true, pid=container_id", async () => {
    const { docker } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    expect(docker.create).toHaveBeenCalledOnce();
    expect(docker.start).toHaveBeenCalledOnce();
    expect(docker.attach).toHaveBeenCalledOnce();
    expect(pty.pid).toBe("container-1");
  });

  it("init 실패 → emit_exit(1), exit_listeners 호출", async () => {
    const { docker } = make_docker({ create: vi.fn().mockRejectedValue(new Error("docker error")) });
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    await wait_init();
    // 약간 더 기다림 (emit_exit가 비동기로 처리될 수 있음)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 1 });
  });
});

// ══════════════════════════════════════════════════════════
// write
// ══════════════════════════════════════════════════════════

describe("DockerPty — write", () => {
  it("ready 전 → write_buffer에 저장", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    // init 완료 전에 write
    pty.write("hello");
    expect(stdin.write).not.toHaveBeenCalled();
    await wait_init();
    // init 후 buffer flush → stdin.write("hello")
    expect(stdin.write).toHaveBeenCalledWith("hello");
  });

  it("ready 후 → stdin.write 직접 호출", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    pty.write("world");
    expect(stdin.write).toHaveBeenCalledWith("world");
  });

  it("exited=true → write 무시", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    pty.kill();
    stdin.write.mockClear();
    pty.write("ignored");
    expect(stdin.write).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// end
// ══════════════════════════════════════════════════════════

describe("DockerPty — end", () => {
  it("ready 전 → write_buffer에 data + EOT 추가", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    pty.end("final");
    expect(stdin.end).not.toHaveBeenCalled();
    await wait_init();
    // flush: "final" 과 "\x04" (EOT)가 write됨, 그 후 end 호출 없음
    // (write_buffer.push만 했으므로 flush 시 stdin.write 2번 호출)
    expect(stdin.write).toHaveBeenCalledWith("final");
    expect(stdin.write).toHaveBeenCalledWith("\x04");
  });

  it("ready 전 data=undefined → EOT만 추가", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    pty.end();
    await wait_init();
    // data가 없으므로 EOT만
    expect(stdin.write).toHaveBeenCalledWith("\x04");
  });

  it("ready 후 → stdin.write(data) + stdin.end()", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    stdin.write.mockClear();
    pty.end("bye");
    expect(stdin.write).toHaveBeenCalledWith("bye");
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it("ready 후 data=undefined → stdin.end()만", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    pty.end();
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it("exited=true → end 무시", async () => {
    const { docker, stdin } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    pty.kill();
    stdin.end.mockClear();
    pty.end("ignored");
    expect(stdin.end).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// onData / onExit
// ══════════════════════════════════════════════════════════

describe("DockerPty — onData / onExit", () => {
  it("onData → stdout data 이벤트 → 콜백 호출", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    const data_cb = vi.fn();
    pty.onData(data_cb);
    await wait_init();
    stdout.emit("data", "chunk1");
    expect(data_cb).toHaveBeenCalledWith("chunk1");
  });

  it("onData → dispose → 이후 이벤트 수신 안 함", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    const data_cb = vi.fn();
    const { dispose } = pty.onData(data_cb);
    await wait_init();
    dispose();
    stdout.emit("data", "ignored");
    expect(data_cb).not.toHaveBeenCalled();
  });

  it("onExit: exited=true → 즉시 cb({ exitCode: 1 }) 호출", async () => {
    const { docker } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    pty.kill(); // exited = true
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 1 });
  });

  it("stdout close 이벤트 → emit_exit(0)", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    await wait_init();
    stdout.emit("close");
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 0 });
  });

  it("stdout error 이벤트 → emit_exit(1)", async () => {
    const { docker, stdout } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    await wait_init();
    stdout.emit("error", new Error("stream error"));
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 1 });
  });
});

// ══════════════════════════════════════════════════════════
// kill
// ══════════════════════════════════════════════════════════

describe("DockerPty — kill", () => {
  it("kill → docker.kill + docker.rm 호출, emit_exit(137)", async () => {
    const { docker } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    pty.kill();
    expect(exit_cb).toHaveBeenCalledWith({ exitCode: 137 });
  });

  it("kill 두 번 → 두 번째는 무시", async () => {
    const { docker } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    await wait_init();
    const exit_cb = vi.fn();
    pty.onExit(exit_cb);
    pty.kill();
    pty.kill(); // 두 번째는 exited=true라 무시
    expect(exit_cb).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// resize (no-op)
// ══════════════════════════════════════════════════════════

describe("DockerPty — resize", () => {
  it("호출해도 에러 없음 (no-op)", async () => {
    const { docker } = make_docker();
    const pty = new DockerPty(docker, "claude", [], make_spawn_options(), make_pty_opts(docker));
    expect(() => pty.resize()).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════
// build_volumes (bridge)
// ══════════════════════════════════════════════════════════

describe("DockerPty — build_volumes", () => {
  it("bridge 없음 → volumes=undefined (빈 배열)", async () => {
    const { docker } = make_docker();
    new DockerPty(docker, "claude", [], make_spawn_options(), {
      docker, image: "node:22-slim",
    });
    await wait_init();
    const create_call = docker.create.mock.calls[0][0] as any;
    expect(create_call.volumes).toBeUndefined();
  });

  it("bridge 있음 → volumes에 bridge 경로 포함", async () => {
    const { docker } = make_docker();
    new DockerPty(docker, "claude", [], make_spawn_options(), {
      docker,
      image: "node:22-slim",
      bridge: { socket_dir: "/host/sock", script_path: "/host/br.sh", mcp_config_path: "/host/mcp.json" },
    });
    await wait_init();
    const create_call = docker.create.mock.calls[0][0] as any;
    expect(Array.isArray(create_call.volumes)).toBe(true);
    expect(create_call.volumes.some((v: string) => v.includes("/sf/bridge"))).toBe(true);
  });

  it("volumes + bridge → 모두 포함", async () => {
    const { docker } = make_docker();
    new DockerPty(docker, "claude", [], make_spawn_options(), {
      docker,
      image: "node:22-slim",
      volumes: ["/host/data:/container/data:ro"],
      bridge: { socket_dir: "/host/sock", script_path: "/host/br.sh", mcp_config_path: "/host/mcp.json" },
    });
    await wait_init();
    const create_call = docker.create.mock.calls[0][0] as any;
    expect(create_call.volumes.length).toBeGreaterThanOrEqual(4); // 1 + 3 bridge
    expect(create_call.volumes[0]).toBe("/host/data:/container/data:ro");
  });
});

// ══════════════════════════════════════════════════════════
// create_docker_pty_factory
// ══════════════════════════════════════════════════════════

describe("create_docker_pty_factory", () => {
  it("PtyFactory 반환 → 호출 시 DockerPty 인스턴스 생성", async () => {
    const { docker } = make_docker();
    const factory = create_docker_pty_factory({ docker, image: "node:22-slim" });
    const pty = factory("claude", [], make_spawn_options());
    expect(pty).toBeInstanceOf(DockerPty);
    await wait_init(); // 초기화 완료 대기
  });
});
