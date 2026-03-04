import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerPty, create_docker_pty_factory, type DockerPtyOptions } from "@src/agent/pty/docker-pty.ts";
import type { DockerOps, ContainerCreateOpts } from "@src/agent/pty/docker-ops.ts";
import type { PtySpawnOptions } from "@src/agent/pty/types.ts";
import { PassThrough } from "node:stream";

function create_mock_docker(): DockerOps & {
  mock_stdout: PassThrough;
  created_opts: ContainerCreateOpts | null;
} {
  const mock_stdout = new PassThrough();
  let created_opts: ContainerCreateOpts | null = null;

  return {
    mock_stdout,
    get created_opts() { return created_opts; },
    create: vi.fn(async (opts: ContainerCreateOpts) => {
      created_opts = opts;
      return "container-id-abc";
    }),
    start: vi.fn(async () => {}),
    attach: vi.fn(async () => ({
      stdin: new PassThrough(),
      stdout: mock_stdout,
    })),
    stop: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({
      id: "container-id-abc",
      name: "agent-test",
      state: "running",
      labels: {},
    })),
    list: vi.fn(async () => []),
  };
}

const spawn_opts: PtySpawnOptions = {
  name: "agent-test-session",
  cwd: "/workspace",
  env: { API_KEY: "test" },
};

describe("DockerPty", () => {
  let docker: ReturnType<typeof create_mock_docker>;
  let pty_opts: DockerPtyOptions;

  beforeEach(() => {
    docker = create_mock_docker();
    pty_opts = {
      docker,
      image: "soulflow/agent-runner:latest",
    };
  });

  it("create + start + attach 순서로 호출", async () => {
    const pty = new DockerPty(docker, "claude", ["--headless"], spawn_opts, pty_opts);

    // init 비동기 완료 대기
    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());

    expect(docker.create).toHaveBeenCalledTimes(1);
    expect(docker.start).toHaveBeenCalledTimes(1);
    expect(docker.attach).toHaveBeenCalledTimes(1);

    // create 옵션에 보안 기본값 포함 확인
    const opts = docker.created_opts!;
    expect(opts.name).toBe("agent-test-session");
    expect(opts.image).toBe("soulflow/agent-runner:latest");
    expect(opts.cmd).toEqual(["claude", "--headless"]);
    expect(opts.memory).toBe("512m");
    expect(opts.cap_drop).toEqual(["ALL"]);
    expect(opts.read_only).toBe(true);
    expect(opts.stdin_open).toBe(true);

    pty.kill();
  });

  it("onData로 stdout 수신", async () => {
    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);
    const chunks: string[] = [];
    pty.onData((data) => chunks.push(data));

    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());

    docker.mock_stdout.push('{"type":"complete","result":"ok"}\n');

    await vi.waitFor(() => expect(chunks.length).toBeGreaterThan(0));
    expect(chunks[0]).toContain("complete");

    pty.kill();
  });

  it("init 전 write는 버퍼링 후 flush", async () => {
    const stdin_stream = new PassThrough();
    const write_spy = vi.spyOn(stdin_stream, "write");

    docker.attach = vi.fn(async () => ({
      stdin: stdin_stream,
      stdout: new PassThrough(),
    }));

    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);

    // init 전 write
    pty.write("buffered-1");
    pty.write("buffered-2");

    // init 완료 대기
    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());
    // flush 후 약간 대기
    await new Promise((r) => setTimeout(r, 10));

    // 버퍼 내용이 stdin에 flush 됨
    const written = write_spy.mock.calls.map((c) => c[0]);
    expect(written).toContain("buffered-1");
    expect(written).toContain("buffered-2");

    pty.kill();
  });

  it("kill 시 docker kill + rm 호출", async () => {
    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);
    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());

    pty.kill();

    expect(docker.kill).toHaveBeenCalled();
    expect(docker.rm).toHaveBeenCalled();
  });

  it("onExit 콜백 호출", async () => {
    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);
    const exits: number[] = [];
    pty.onExit((e) => exits.push(e.exitCode));

    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());

    // stdout close → exit 이벤트
    docker.mock_stdout.destroy();

    await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0));
    expect(exits[0]).toBe(0);
  });

  it("dispose로 리스너 해제", async () => {
    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);
    const chunks: string[] = [];
    const sub = pty.onData((data) => chunks.push(data));
    sub.dispose();

    await vi.waitFor(() => expect(docker.attach).toHaveBeenCalled());
    docker.mock_stdout.push("data\n");
    await new Promise((r) => setTimeout(r, 10));

    expect(chunks).toHaveLength(0);
    pty.kill();
  });

  it("init 에러 시 exit 이벤트 발생", async () => {
    docker.create = vi.fn(async () => { throw new Error("image not found"); });

    const pty = new DockerPty(docker, "claude", [], spawn_opts, pty_opts);
    const exits: number[] = [];
    pty.onExit((e) => exits.push(e.exitCode));

    await vi.waitFor(() => expect(exits.length).toBeGreaterThan(0));
    expect(exits[0]).toBe(1);
  });

  it("커스텀 보안 옵션 오버라이드", async () => {
    const custom_opts: DockerPtyOptions = {
      docker,
      image: "custom:latest",
      security: { memory: "1g", network_mode: "bridge" },
    };

    const pty = new DockerPty(docker, "claude", [], spawn_opts, custom_opts);
    await vi.waitFor(() => expect(docker.create).toHaveBeenCalled());

    const opts = docker.created_opts!;
    expect(opts.memory).toBe("1g");
    expect(opts.network_mode).toBe("bridge");
    // 나머지는 기본값 유지
    expect(opts.cap_drop).toEqual(["ALL"]);

    pty.kill();
  });
});

describe("create_docker_pty_factory", () => {
  it("PtyFactory 인터페이스 반환", () => {
    const docker = create_mock_docker();
    const factory = create_docker_pty_factory({ docker, image: "test:latest" });

    expect(typeof factory).toBe("function");

    const pty = factory("claude", ["--headless"], spawn_opts);
    expect(pty).toBeDefined();
    expect(typeof pty.write).toBe("function");
    expect(typeof pty.onData).toBe("function");
    expect(typeof pty.kill).toBe("function");

    pty.kill();
  });
});
