import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliDockerOps, type ContainerCreateOpts } from "@src/agent/pty/docker-ops.ts";
import { execFile, spawn } from "node:child_process";
import { EventEmitter, PassThrough } from "node:stream";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

const mock_exec = vi.mocked(execFile);
const mock_spawn = vi.mocked(spawn);

/** execFile 성공 응답을 설정. */
function stub_exec(stdout: string) {
  mock_exec.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, stdout, "");
    return {} as any;
  });
}

/** execFile 에러 응답을 설정. */
function stub_exec_error(stderr: string) {
  mock_exec.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(new Error("exit 1"), "", stderr);
    return {} as any;
  });
}

describe("CliDockerOps", () => {
  let ops: CliDockerOps;

  beforeEach(() => {
    vi.clearAllMocks();
    ops = new CliDockerOps();
  });

  describe("create", () => {
    it("보안 옵션으로 docker create 호출", async () => {
      stub_exec("abc123def\n");

      const opts: ContainerCreateOpts = {
        name: "agent-test",
        image: "soulflow/agent-runner:latest",
        cmd: ["claude", "--headless"],
        working_dir: "/workspace",
        stdin_open: true,
        memory: "512m",
        cpus: 1.0,
        network_mode: "none",
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges"],
        read_only: true,
        tmpfs: { "/tmp": "size=100m" },
        user: "1000:1000",
        pids_limit: 100,
        labels: { "sf.session_key": "s1" },
        env: { ANTHROPIC_API_KEY: "sk-test" },
      };

      const id = await ops.create(opts);
      expect(id).toBe("abc123def");

      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("create");
      expect(call_args).toContain("--name");
      expect(call_args).toContain("-i");
      expect(call_args).toContain("--memory");
      expect(call_args).toContain("--cap-drop");
      expect(call_args).toContain("--read-only");
      expect(call_args).toContain("--user");
      expect(call_args).toContain("--pids-limit");
      expect(call_args).toContain("--network");
      expect(call_args).toContain("soulflow/agent-runner:latest");
    });

    it("에러 시 예외 발생", async () => {
      stub_exec_error("name already in use");
      await expect(ops.create({
        name: "dup", image: "img", cmd: [],
      })).rejects.toThrow("name already in use");
    });

    it("volumes 옵션 전달", async () => {
      stub_exec("cid\n");
      await ops.create({ name: "v", image: "img", cmd: [], volumes: ["/host:/container"] });
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("-v");
      expect(call_args).toContain("/host:/container");
    });

    it("secrets 옵션 전달", async () => {
      stub_exec("cid\n");
      await ops.create({ name: "s", image: "img", cmd: [], secrets: ["mysecret"] });
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("--secret");
      expect(call_args).toContain("mysecret");
    });
  });

  describe("start", () => {
    it("docker start 호출", async () => {
      stub_exec("");
      await ops.start("abc123");
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("start");
      expect(call_args).toContain("abc123");
    });
  });

  describe("attach", () => {
    it("stdin/stdout 스트림 반환", async () => {
      const proc = new EventEmitter() as any;
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      mock_spawn.mockReturnValue(proc);

      const result = await ops.attach("abc123");
      expect(result.stdin).toBeDefined();
      expect(result.stdout).toBeDefined();

      const call_args = mock_spawn.mock.calls[0]![1] as string[];
      expect(call_args).toContain("attach");
      expect(call_args).toContain("abc123");
    });

    it("stdin/stdout 없으면 에러 발생", async () => {
      const proc = new EventEmitter() as any;
      proc.stdin = null;
      proc.stdout = null;
      mock_spawn.mockReturnValue(proc);
      await expect(ops.attach("bad")).rejects.toThrow("docker attach failed");
    });
  });

  describe("kill / rm / stop", () => {
    it("docker kill 호출", async () => {
      stub_exec("");
      await ops.kill("abc123");
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("kill");
    });

    it("docker rm -f 호출", async () => {
      stub_exec("");
      await ops.rm("abc123");
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("rm");
      expect(call_args).toContain("-f");
    });

    it("docker stop 타임아웃 전달", async () => {
      stub_exec("");
      await ops.stop("abc123", 5);
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("stop");
      expect(call_args).toContain("-t");
      expect(call_args).toContain("5");
    });
  });

  describe("inspect", () => {
    it("컨테이너 정보 파싱", async () => {
      stub_exec(JSON.stringify({
        Id: "full-id-123",
        Name: "/agent-test",
        State: { Status: "running" },
        Config: { Labels: { "sf.cli": "claude" } },
      }));

      const info = await ops.inspect("abc");
      expect(info.id).toBe("full-id-123");
      expect(info.name).toBe("agent-test");
      expect(info.state).toBe("running");
      expect(info.labels["sf.cli"]).toBe("claude");
    });
  });

  describe("list", () => {
    it("필터와 함께 컨테이너 목록 반환", async () => {
      const lines = [
        JSON.stringify({ ID: "id1", Names: "agent-1", State: "running", Labels: "sf.cli=claude" }),
        JSON.stringify({ ID: "id2", Names: "agent-2", State: "exited", Labels: "sf.cli=codex" }),
      ].join("\n");
      stub_exec(lines);

      const result = await ops.list({ label: ["sf.session_key"] });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("id1");
      expect(result[1]!.labels["sf.cli"]).toBe("codex");

      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args).toContain("--filter");
      expect(call_args).toContain("label=sf.session_key");
    });

    it("빈 결과 시 빈 배열 반환", async () => {
      stub_exec("");
      const result = await ops.list({});
      expect(result).toEqual([]);
    });
  });

  describe("docker_host", () => {
    it("-H 플래그 추가", async () => {
      const remote = new CliDockerOps({ docker_host: "tcp://proxy:2375" });
      stub_exec("");
      await remote.start("abc");
      const call_args = mock_exec.mock.calls[0]![1] as string[];
      expect(call_args[0]).toBe("-H");
      expect(call_args[1]).toBe("tcp://proxy:2375");
    });
  });
});
