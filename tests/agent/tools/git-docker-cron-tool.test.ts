/**
 * GitTool / DockerTool / CronShellTool 커버리지.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { GitTool } from "@src/agent/tools/git.js";
import { DockerTool } from "@src/agent/tools/docker.js";
import { CronShellTool } from "@src/agent/tools/cron-shell.js";

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import * as shell_runtime from "@src/agent/tools/shell-runtime.js";
const mock_shell = shell_runtime.run_shell_command as ReturnType<typeof vi.fn>;

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

function make_shell_ok(stdout = "", stderr = "") {
  mock_shell.mockResolvedValue({ stdout, stderr });
}

// ══════════════════════════════════════════
// GitTool
// ══════════════════════════════════════════

function make_git() {
  return new GitTool({ workspace: "/tmp/workspace" });
}

describe("GitTool — 메타데이터", () => {
  it("name = git", () => expect(make_git().name).toBe("git"));
  it("category = shell", () => expect(make_git().category).toBe("shell"));
  it("policy_flags: write=true", () => expect(make_git().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_git().to_schema().type).toBe("function"));
});

describe("GitTool — AbortSignal", () => {
  it("signal aborted → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await make_git().execute({ operation: "status" }, { signal: ctrl.signal });
    expect(r).toContain("cancelled");
  });
});

describe("GitTool — 각 operation", () => {
  beforeEach(() => make_shell_ok("output line", ""));

  it("status → git status 실행", async () => {
    const r = await make_git().execute({ operation: "status" });
    expect(r).toBe("output line");
    expect(mock_shell.mock.calls[0][0]).toContain("git status");
  });

  it("diff → git diff 실행", async () => {
    await make_git().execute({ operation: "diff" });
    expect(mock_shell.mock.calls[0][0]).toContain("git diff");
  });

  it("log → git log 실행", async () => {
    await make_git().execute({ operation: "log" });
    expect(mock_shell.mock.calls[0][0]).toContain("git log");
  });

  it("commit + args → git commit -m 실행", async () => {
    await make_git().execute({ operation: "commit", args: "Add feature" });
    expect(mock_shell.mock.calls[0][0]).toContain("git commit -m");
    expect(mock_shell.mock.calls[0][0]).toContain("Add feature");
  });

  it("commit 인자 없음 → unsupported operation", async () => {
    const r = await make_git().execute({ operation: "commit" });
    expect(r).toContain("unsupported");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("push → git push 실행", async () => {
    await make_git().execute({ operation: "push" });
    expect(mock_shell.mock.calls[0][0]).toContain("git push");
  });

  it("pull → git pull 실행", async () => {
    await make_git().execute({ operation: "pull" });
    expect(mock_shell.mock.calls[0][0]).toContain("git pull");
  });

  it("branch → git branch 실행", async () => {
    await make_git().execute({ operation: "branch" });
    expect(mock_shell.mock.calls[0][0]).toContain("git branch");
  });

  it("checkout + args → git checkout 실행", async () => {
    await make_git().execute({ operation: "checkout", args: "main" });
    expect(mock_shell.mock.calls[0][0]).toContain("git checkout main");
  });

  it("checkout 인자 없음 → unsupported operation", async () => {
    const r = await make_git().execute({ operation: "checkout" });
    expect(r).toContain("unsupported");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("stash → git stash 실행", async () => {
    await make_git().execute({ operation: "stash" });
    expect(mock_shell.mock.calls[0][0]).toContain("git stash");
  });

  it("tag + args → git tag 실행", async () => {
    await make_git().execute({ operation: "tag", args: "v1.0.0" });
    expect(mock_shell.mock.calls[0][0]).toContain("git tag v1.0.0");
  });
});

describe("GitTool — 출력 처리", () => {
  it("stdout만 → 그대로 반환", async () => {
    make_shell_ok("clean output", "");
    const r = await make_git().execute({ operation: "status" });
    expect(r).toBe("clean output");
  });

  it("stdout + stderr → 둘 다 포함", async () => {
    make_shell_ok("output", "warning");
    const r = await make_git().execute({ operation: "status" });
    expect(r).toContain("output");
    expect(r).toContain("STDERR:");
    expect(r).toContain("warning");
  });

  it("빈 출력 → (no output)", async () => {
    make_shell_ok("", "");
    const r = await make_git().execute({ operation: "status" });
    expect(r).toBe("(no output)");
  });

  it("20000자 초과 → 잘림 표시", async () => {
    make_shell_ok("x".repeat(25000), "");
    const r = await make_git().execute({ operation: "log" });
    expect(r).toContain("truncated");
    expect(r.length).toBeLessThan(25000);
  });

  it("셸 실행 오류 → Error 반환", async () => {
    mock_shell.mockRejectedValue(new Error("git not found"));
    const r = await make_git().execute({ operation: "status" });
    expect(r).toContain("Error");
    expect(r).toContain("git not found");
  });

  it("working_dir 파라미터 → cwd로 사용", async () => {
    make_shell_ok("result", "");
    await make_git().execute({ operation: "status", working_dir: "/custom/repo" });
    expect(mock_shell.mock.calls[0][1].cwd).toBe("/custom/repo");
  });
});

// ══════════════════════════════════════════
// DockerTool
// ══════════════════════════════════════════

function make_docker() {
  return new DockerTool({ workspace: "/tmp/workspace" });
}

describe("DockerTool — 메타데이터", () => {
  it("name = docker", () => expect(make_docker().name).toBe("docker"));
  it("category = shell", () => expect(make_docker().category).toBe("shell"));
  it("policy_flags: write=true", () => expect(make_docker().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_docker().to_schema().type).toBe("function"));
});

describe("DockerTool — AbortSignal", () => {
  it("signal aborted → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await make_docker().execute({ operation: "ps" }, { signal: ctrl.signal });
    expect(r).toContain("cancelled");
  });
});

describe("DockerTool — 각 operation", () => {
  beforeEach(() => make_shell_ok("container_id", ""));

  it("ps → docker ps -a 실행", async () => {
    await make_docker().execute({ operation: "ps" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker ps -a");
  });

  it("images → docker images 실행", async () => {
    await make_docker().execute({ operation: "images" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker images");
  });

  it("run + image → docker run 실행", async () => {
    await make_docker().execute({ operation: "run", image: "nginx:latest" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker run");
    expect(mock_shell.mock.calls[0][0]).toContain("nginx:latest");
  });

  it("run 이미지 없음 → Error 반환", async () => {
    const r = await make_docker().execute({ operation: "run" });
    expect(r).toContain("Error");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("stop + container → docker stop 실행", async () => {
    await make_docker().execute({ operation: "stop", container: "myapp" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker stop myapp");
  });

  it("stop 컨테이너 없음 → Error 반환", async () => {
    const r = await make_docker().execute({ operation: "stop" });
    expect(r).toContain("Error");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("rm + container → docker rm 실행", async () => {
    await make_docker().execute({ operation: "rm", container: "old_ctr" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker rm old_ctr");
  });

  it("logs + container → docker logs 실행", async () => {
    await make_docker().execute({ operation: "logs", container: "api", tail: 100 });
    const cmd = mock_shell.mock.calls[0][0] as string;
    expect(cmd).toContain("docker logs");
    expect(cmd).toContain("api");
    expect(cmd).toContain("100");
  });

  it("exec + container + command → docker exec 실행", async () => {
    await make_docker().execute({ operation: "exec", container: "api", command: "ls /app" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker exec");
    expect(mock_shell.mock.calls[0][0]).toContain("ls /app");
  });

  it("exec 컨테이너 없음 → Error 반환", async () => {
    const r = await make_docker().execute({ operation: "exec", command: "ls" });
    expect(r).toContain("Error");
    expect(mock_shell).not.toHaveBeenCalled();
  });

  it("inspect + container → docker inspect 실행", async () => {
    await make_docker().execute({ operation: "inspect", container: "api" });
    expect(mock_shell.mock.calls[0][0]).toContain("docker inspect api");
  });

  it("unsupported operation → Error 반환", async () => {
    const r = await make_docker().execute({ operation: "unknown_op" });
    expect(r).toContain("Error");
    expect(mock_shell).not.toHaveBeenCalled();
  });
});

describe("DockerTool — 보안 정책", () => {
  it("--privileged 포함 → blocked 반환", async () => {
    make_shell_ok("", "");
    const r = await make_docker().execute({ operation: "run", image: "ubuntu", args: "--privileged" });
    expect(r).toContain("Error");
    expect(r).toContain("safety policy");
  });

  it("-v /: 포함 → blocked 반환", async () => {
    make_shell_ok("", "");
    const r = await make_docker().execute({ operation: "run", image: "ubuntu", args: "-v /:/host" });
    expect(r).toContain("Error");
    expect(r).toContain("safety policy");
  });
});

describe("DockerTool — 출력 처리", () => {
  it("셸 실행 오류 → Error 반환", async () => {
    mock_shell.mockRejectedValue(new Error("docker not found"));
    const r = await make_docker().execute({ operation: "ps" });
    expect(r).toContain("Error");
    expect(r).toContain("docker not found");
  });

  it("빈 출력 → (no output)", async () => {
    make_shell_ok("", "");
    const r = await make_docker().execute({ operation: "ps" });
    expect(r).toBe("(no output)");
  });
});

// ══════════════════════════════════════════
// CronShellTool
// ══════════════════════════════════════════

function make_cron() {
  return new CronShellTool({ workspace: "/tmp/workspace" });
}

describe("CronShellTool — 메타데이터", () => {
  it("name = cron_shell", () => expect(make_cron().name).toBe("cron_shell"));
  it("category = scheduling", () => expect(make_cron().category).toBe("scheduling"));
  it("policy_flags: write=true", () => expect(make_cron().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_cron().to_schema().type).toBe("function"));
});

describe("CronShellTool — list", () => {
  it("등록된 잡 없음 → no scheduled jobs", async () => {
    const r = await make_cron().execute({ operation: "list" });
    expect(r).toContain("no scheduled jobs");
  });

  it("잡 등록 후 list → 잡 목록 반환", async () => {
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "j1", expression: "*/5 * * * *", command: "echo hello" });
    const r = await cron.execute({ operation: "list" });
    expect(r).toContain("j1");
    expect(r).toContain("*/5 * * * *");
  });
});

describe("CronShellTool — register", () => {
  it("필수 파라미터 없음 → Error 반환", async () => {
    const r = await make_cron().execute({ operation: "register" });
    expect(r).toContain("Error");
    expect(r).toContain("required");
  });

  it("지원하지 않는 cron 표현식 → Error 반환", async () => {
    const r = await make_cron().execute({
      operation: "register", id: "j1", expression: "0 9 * * 1-5", command: "echo x",
    });
    expect(r).toContain("Error");
    expect(r).toContain("interval");
  });

  it("*/5 형식 표현식 → 등록 성공", async () => {
    const r = await make_cron().execute({
      operation: "register", id: "job1", expression: "*/5 * * * *", command: "date",
    });
    expect(r).toContain("job1");
    expect(r).toContain("300s");
  });

  it("0 */2 형식 표현식 → 시간 단위 등록 성공", async () => {
    const r = await make_cron().execute({
      operation: "register", id: "hourly", expression: "0 */2 * * *", command: "backup.sh",
    });
    expect(r).toContain("hourly");
    expect(r).toContain("7200s");
  });

  it("* * 형식 표현식 → 60초 등록", async () => {
    const r = await make_cron().execute({
      operation: "register", id: "minutely", expression: "* * * * *", command: "tick",
    });
    expect(r).toContain("60s");
  });

  it("이미 등록된 ID 재등록 → 덮어쓰기", async () => {
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "dup", expression: "*/1 * * * *", command: "first" });
    const r = await cron.execute({ operation: "register", id: "dup", expression: "*/2 * * * *", command: "second" });
    expect(r).toContain("dup");
  });
});

describe("CronShellTool — remove", () => {
  it("id 없음 → Error 반환", async () => {
    const r = await make_cron().execute({ operation: "remove" });
    expect(r).toContain("Error");
    expect(r).toContain("id");
  });

  it("존재하지 않는 id → not found 반환", async () => {
    const r = await make_cron().execute({ operation: "remove", id: "ghost" });
    expect(r).toContain("ghost");
    expect(r).toContain("not found");
  });

  it("등록 후 제거 → Removed 반환", async () => {
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "del_me", expression: "*/1 * * * *", command: "echo x" });
    const r = await cron.execute({ operation: "remove", id: "del_me" });
    expect(r).toContain("Removed");
    expect(r).toContain("del_me");
  });
});

describe("CronShellTool — trigger", () => {
  it("존재하지 않는 id → Error 반환", async () => {
    const r = await make_cron().execute({ operation: "trigger", id: "nope" });
    expect(r).toContain("Error");
    expect(r).toContain("nope");
  });

  it("등록 후 trigger → 실행 결과 반환", async () => {
    mock_shell.mockResolvedValue({ stdout: "triggered!", stderr: "" });
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "t1", expression: "*/1 * * * *", command: "echo hi" });
    const r = await cron.execute({ operation: "trigger", id: "t1" });
    expect(r).toContain("t1");
    expect(r).toContain("triggered!");
  });

  it("trigger 셸 오류 → error 필드 저장", async () => {
    mock_shell.mockRejectedValue(new Error("cmd failed"));
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "fail_job", expression: "*/1 * * * *", command: "bad_cmd" });
    const r = await cron.execute({ operation: "trigger", id: "fail_job" });
    expect(r).toContain("fail_job");
  });
});

describe("CronShellTool — status", () => {
  it("존재하지 않는 id → Error 반환", async () => {
    const r = await make_cron().execute({ operation: "status", id: "ghost" });
    expect(r).toContain("Error");
  });

  it("등록 후 status → JSON 반환", async () => {
    const cron = make_cron();
    await cron.execute({ operation: "register", id: "s1", expression: "*/1 * * * *", command: "ping" });
    const r = await cron.execute({ operation: "status", id: "s1" });
    const parsed = JSON.parse(r);
    expect(parsed.id).toBe("s1");
    expect(parsed.expression).toBe("*/1 * * * *");
    expect(parsed.run_count).toBe(0);
    expect(parsed.enabled).toBe(true);
  });
});

describe("CronShellTool — unsupported", () => {
  it("unsupported operation → Error 반환", async () => {
    const r = await make_cron().execute({ operation: "enable" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});
