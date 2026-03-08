/**
 * SshTool — exec/scp_upload/scp_download/info/default 액션 + execFile mock 테스트.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── execFile mock ─────────────────────────────────────
const { mock_exec_file } = vi.hoisted(() => ({ mock_exec_file: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: mock_exec_file,
}));

// ── import after mock ─────────────────────────────────
import { SshTool } from "@src/agent/tools/ssh.js";

function make_tool(): SshTool { return new SshTool(); }

/** execFile 성공 응답 설정 */
function set_exec_success(stdout: string, stderr = "") {
  mock_exec_file.mockImplementationOnce((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: null, out: string, err2: string) => void) => {
    cb(null, stdout, stderr);
  });
}

/** execFile 에러 응답 설정 */
function set_exec_error(msg: string, stderr = "error output") {
  mock_exec_file.mockImplementationOnce((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error, out: string, err2: string) => void) => {
    cb(new Error(msg), "", stderr);
  });
}

beforeEach(() => {
  mock_exec_file.mockReset();
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("SshTool — 메타데이터", () => {
  it("name = ssh", () => expect(make_tool().name).toBe("ssh"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// 파라미터 검증
// ══════════════════════════════════════════

describe("SshTool — 파라미터 검증", () => {
  it("host 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "exec", host: "" });
    expect(String(r)).toContain("Error");
  });

  it("exec: command 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "exec", host: "server.example.com" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("command");
  });

  it("scp_upload: local_path/remote_path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "scp_upload", host: "server.example.com" });
    expect(String(r)).toContain("Error");
  });

  it("scp_download: local_path/remote_path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "scp_download", host: "server.example.com" });
    expect(String(r)).toContain("Error");
  });

  it("지원하지 않는 action → Error", async () => {
    const r = await make_tool().execute({ action: "unknown", host: "server.example.com" });
    expect(String(r)).toContain("Error");
  });
});

// ══════════════════════════════════════════
// exec action
// ══════════════════════════════════════════

describe("SshTool — exec action", () => {
  it("exec 성공 → success:true + stdout 포함", async () => {
    set_exec_success("root\n/home/user\n");
    const r = JSON.parse(await make_tool().execute({ action: "exec", host: "server.example.com", command: "whoami" }));
    expect(r.success).toBe(true);
    expect(r.stdout).toContain("root");
  });

  it("exec 실패 → success:false + error 포함", async () => {
    set_exec_error("Connection refused");
    const r = JSON.parse(await make_tool().execute({ action: "exec", host: "server.example.com", command: "ls" }));
    expect(r.success).toBe(false);
    expect(r.error).toContain("Connection refused");
  });

  it("포트 지정 → 정상 동작", async () => {
    set_exec_success("ok");
    const r = JSON.parse(await make_tool().execute({
      action: "exec", host: "server.example.com", port: 2222, command: "echo ok",
    }));
    expect(r.success).toBe(true);
  });

  it("identity_file 지정 → 정상 동작", async () => {
    set_exec_success("ok");
    const r = JSON.parse(await make_tool().execute({
      action: "exec", host: "server.example.com", command: "echo ok",
      identity_file: "/home/user/.ssh/id_rsa",
    }));
    expect(r.success).toBe(true);
  });
});

// ══════════════════════════════════════════
// scp_upload action
// ══════════════════════════════════════════

describe("SshTool — scp_upload action", () => {
  it("scp_upload 성공 → success:true", async () => {
    set_exec_success("");
    const r = JSON.parse(await make_tool().execute({
      action: "scp_upload", host: "server.example.com",
      local_path: "/tmp/file.txt", remote_path: "/home/user/file.txt",
    }));
    expect(r.success).toBe(true);
  });

  it("scp_upload + identity_file → 정상 동작", async () => {
    set_exec_success("");
    const r = JSON.parse(await make_tool().execute({
      action: "scp_upload", host: "server.example.com",
      local_path: "/tmp/a", remote_path: "/tmp/b",
      identity_file: "/home/user/.ssh/id_rsa",
    }));
    expect(r.success).toBe(true);
  });
});

// ══════════════════════════════════════════
// scp_download action
// ══════════════════════════════════════════

describe("SshTool — scp_download action", () => {
  it("scp_download 성공 → success:true", async () => {
    set_exec_success("");
    const r = JSON.parse(await make_tool().execute({
      action: "scp_download", host: "server.example.com",
      local_path: "/tmp/file.txt", remote_path: "/home/user/file.txt",
    }));
    expect(r.success).toBe(true);
  });

  it("scp_download + identity_file → 정상 동작", async () => {
    set_exec_success("");
    const r = JSON.parse(await make_tool().execute({
      action: "scp_download", host: "server.example.com",
      local_path: "/tmp/a", remote_path: "/tmp/b",
      identity_file: "/home/user/.ssh/id_rsa",
    }));
    expect(r.success).toBe(true);
  });
});

// ══════════════════════════════════════════
// info action
// ══════════════════════════════════════════

describe("SshTool — info action", () => {
  it("info 성공 → success:true + stdout 포함", async () => {
    set_exec_success("Linux server 5.15.0\nroot\n/root");
    const r = JSON.parse(await make_tool().execute({ action: "info", host: "server.example.com" }));
    expect(r.success).toBe(true);
    expect(r.stdout).toContain("Linux");
  });

  it("info 실패 → success:false", async () => {
    set_exec_error("ssh: connect to host server failed");
    const r = JSON.parse(await make_tool().execute({ action: "info", host: "server.example.com" }));
    expect(r.success).toBe(false);
  });
});
