/**
 * shell 기반 도구 — ArchiveTool / SystemInfoTool / ProcessManagerTool / NetworkTool
 * run_shell_command mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_run, mock_argv } = vi.hoisted(() => ({
  mock_run: vi.fn(),
  // ArchiveTool은 shell injection 방지를 위해 run_command_argv를 사용.
  // 별도 인스턴스로 분리해야 mockReturnValueOnce 큐 오염을 방지할 수 있다.
  mock_argv: vi.fn(),
}));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_run,
  run_command_argv: mock_argv,
}));

import { ArchiveTool } from "@src/agent/tools/archive.js";
import { SystemInfoTool } from "@src/agent/tools/system-info.js";
import { ProcessManagerTool } from "@src/agent/tools/process-manager.js";
import { NetworkTool } from "@src/agent/tools/network.js";

const WS = "/tmp/workspace";

function ok(stdout: string, stderr = "") {
  return Promise.resolve({ stdout, stderr });
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// ArchiveTool
// ══════════════════════════════════════════

describe("ArchiveTool — 메타데이터", () => {
  const t = new ArchiveTool({ workspace: WS });
  it("name = archive", () => expect(t.name).toBe("archive"));
  it("category = filesystem", () => expect(t.category).toBe("filesystem"));
  it("to_schema type = function", () => expect(t.to_schema().type).toBe("function"));
});

describe("ArchiveTool — 파라미터 검증", () => {
  it("archive_path 없음 → Error", async () => {
    const r = await new ArchiveTool({ workspace: WS }).execute({ operation: "list", archive_path: "" });
    expect(String(r)).toContain("Error");
  });
});

describe("ArchiveTool — tar.gz 조작", () => {
  it("list 성공", async () => {
    mock_argv.mockReturnValueOnce(ok("file1.txt\nfile2.txt"));
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "list", archive_path: "test.tar.gz",
    });
    expect(r).toContain("file1.txt");
  });

  it("extract 성공", async () => {
    mock_argv.mockReturnValueOnce(ok("", ""));
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "extract", archive_path: "test.tar.gz", output_dir: "/tmp/out",
    });
    expect(String(r)).toContain("extract");
  });

  it("create: files 없음 → Error (null command)", async () => {
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "create", archive_path: "test.tar.gz",
    });
    expect(String(r)).toContain("Error");
  });

  it("create: files 있음 → 성공", async () => {
    mock_argv.mockReturnValueOnce(ok(""));
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "create", archive_path: "test.tar.gz", files: ["src/", "README.md"],
    });
    expect(String(r)).toContain("create");
  });
});

describe("ArchiveTool — zip 조작", () => {
  it("list zip 성공", async () => {
    mock_argv.mockReturnValueOnce(ok("Archive:  test.zip\n  Length  File\n   1234  file.txt"));
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "list", format: "zip", archive_path: "test.zip",
    });
    expect(r).toContain("file.txt");
  });

  it("extract zip 성공", async () => {
    mock_argv.mockReturnValueOnce(ok("inflating: file.txt"));
    const r = await new ArchiveTool({ workspace: WS }).execute({
      operation: "extract", format: "zip", archive_path: "test.zip",
    });
    expect(r).toContain("inflating");
  });
});

describe("ArchiveTool — 취소 신호", () => {
  it("aborted signal → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await new ArchiveTool({ workspace: WS }).execute(
      { operation: "list", archive_path: "test.tar.gz" },
      { signal: ctrl.signal } as any,
    );
    expect(String(r)).toContain("cancelled");
  });
});

// ══════════════════════════════════════════
// SystemInfoTool
// ══════════════════════════════════════════

describe("SystemInfoTool — 메타데이터", () => {
  const t = new SystemInfoTool({ workspace: WS });
  it("name = system_info", () => expect(t.name).toBe("system_info"));
  it("category = shell", () => expect(t.category).toBe("shell"));
  it("to_schema type = function", () => expect(t.to_schema().type).toBe("function"));
});

describe("SystemInfoTool — category 별 수집", () => {
  it("os 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok("Linux 5.15.0"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "os" });
    expect(r).toContain("OS");
    expect(r).toContain("Linux");
  });

  it("uptime 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok(" 12:34:56 up 1 day"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "uptime" });
    expect(r).toContain("up");
  });

  it("cpu 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok("4\nprocessor: 0"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "cpu" });
    expect(r).toContain("CPU");
  });

  it("memory 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok("              total  used  free\nMem:           16G   8G    8G"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "memory" });
    expect(r).toContain("MEMORY");
  });

  it("disk 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok("/dev/sda  100G  40G  60G  40%  /"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "disk" });
    expect(r).toContain("DISK");
  });

  it("network 카테고리", async () => {
    mock_run.mockReturnValueOnce(ok("eth0: ..."));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "network" });
    expect(r).toContain("NETWORK");
  });

  it("all 카테고리 → 6개 섹션 수집", async () => {
    for (let i = 0; i < 6; i++) mock_run.mockReturnValueOnce(ok(`output_${i}`));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "all" });
    expect(r).toContain("OS");
    expect(r).toContain("UPTIME");
  });

  it("명령 실패 → (error: ...) 포함", async () => {
    mock_run.mockRejectedValueOnce(new Error("command not found"));
    const r = await new SystemInfoTool({ workspace: WS }).execute({ category: "os" });
    expect(r).toContain("error");
  });

  it("취소 신호 → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await new SystemInfoTool({ workspace: WS }).execute(
      { category: "os" },
      { signal: ctrl.signal } as any,
    );
    expect(String(r)).toContain("cancelled");
  });
});

// ══════════════════════════════════════════
// ProcessManagerTool
// ══════════════════════════════════════════

describe("ProcessManagerTool — 메타데이터", () => {
  const t = new ProcessManagerTool({ workspace: WS });
  it("name = process_manager", () => expect(t.name).toBe("process_manager"));
  it("category = shell", () => expect(t.category).toBe("shell"));
  it("to_schema type = function", () => expect(t.to_schema().type).toBe("function"));
});

describe("ProcessManagerTool — list", () => {
  it("filter 없음 → ps aux 출력", async () => {
    mock_run.mockReturnValueOnce(ok("USER  PID  CMD\nroot  1  init"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "list" });
    expect(r).toContain("init");
  });

  it("filter 있음 → grep 적용", async () => {
    mock_run.mockReturnValueOnce(ok("USER  PID  CMD\nroot  42  node"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "list", filter: "node" });
    expect(r).toContain("node");
  });

  it("결과 없음 → (no processes found)", async () => {
    mock_run.mockReturnValueOnce(ok(""));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "list" });
    expect(r).toContain("no processes found");
  });
});

describe("ProcessManagerTool — start", () => {
  it("command 없음 → Error", async () => {
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "start" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("command");
  });

  it("command 있음 → 성공", async () => {
    mock_run.mockReturnValueOnce(ok("PID: 1234"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({
      operation: "start", command: "node server.js",
    });
    expect(r).toContain("1234");
  });
});

describe("ProcessManagerTool — stop", () => {
  it("pid 없음 → Error", async () => {
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "stop" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("pid");
  });

  it("pid 있음 → SIGTERM 전송", async () => {
    mock_run.mockReturnValueOnce(ok("Signal SIGTERM sent to PID 42"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "stop", pid: 42 });
    expect(r).toContain("42");
  });

  it("허용되지 않은 signal → SIGTERM 폴백", async () => {
    mock_run.mockReturnValueOnce(ok("Signal SIGTERM sent to PID 99"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({
      operation: "stop", pid: 99, signal: "EVIL",
    });
    expect(r).toContain("SIGTERM");
  });

  it("허용된 signal=SIGKILL", async () => {
    mock_run.mockReturnValueOnce(ok("Signal SIGKILL sent to PID 7"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({
      operation: "stop", pid: 7, signal: "SIGKILL",
    });
    expect(r).toContain("SIGKILL");
  });
});

describe("ProcessManagerTool — info", () => {
  it("pid 없음 → Error", async () => {
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "info" });
    expect(String(r)).toContain("Error");
  });

  it("pid 있음 → ps 출력", async () => {
    mock_run.mockReturnValueOnce(ok("  PID PPID USER  %CPU %MEM\n  42   1   root  0.0  0.1  node"));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "info", pid: 42 });
    expect(r).toContain("node");
  });

  it("프로세스 없음 → 'not found' 포함", async () => {
    mock_run.mockReturnValueOnce(ok(""));
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "info", pid: 9999 });
    expect(r).toContain("not found");
  });
});

describe("ProcessManagerTool — 취소/default", () => {
  it("취소 신호 → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await new ProcessManagerTool({ workspace: WS }).execute(
      { operation: "list" },
      { signal: ctrl.signal } as any,
    );
    expect(String(r)).toContain("cancelled");
  });

  it("unsupported operation → Error", async () => {
    const r = await new ProcessManagerTool({ workspace: WS }).execute({ operation: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});

// ══════════════════════════════════════════
// NetworkTool
// ══════════════════════════════════════════

describe("NetworkTool — 메타데이터", () => {
  const t = new NetworkTool({ workspace: WS });
  it("name = network", () => expect(t.name).toBe("network"));
  it("category = shell", () => expect(t.category).toBe("shell"));
  it("to_schema type = function", () => expect(t.to_schema().type).toBe("function"));
});

describe("NetworkTool — ping", () => {
  it("host 없음 → Error", async () => {
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "ping" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("host");
  });

  it("ping 성공", async () => {
    mock_run.mockReturnValueOnce(ok("PING 8.8.8.8: 56 bytes\nrtt min/avg/max = 1.2/2.3/4.5 ms"));
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "ping", host: "8.8.8.8", count: 2 });
    expect(r).toContain("rtt");
  });
});

describe("NetworkTool — dns", () => {
  it("host 없음 → Error", async () => {
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "dns" });
    expect(String(r)).toContain("Error");
  });

  it("dns 성공", async () => {
    mock_run.mockReturnValueOnce(ok("1.2.3.4"));
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "dns", host: "example.com" });
    expect(r).toContain("1.2.3.4");
  });
});

describe("NetworkTool — port_check", () => {
  it("host/port 없음 → Error", async () => {
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "port_check", host: "example.com" });
    expect(String(r)).toContain("Error");
  });

  it("port_check 성공", async () => {
    mock_run.mockReturnValueOnce(ok("OPEN"));
    const r = await new NetworkTool({ workspace: WS }).execute({
      operation: "port_check", host: "example.com", port: 443,
    });
    expect(r).toContain("OPEN");
  });
});

describe("NetworkTool — http_head", () => {
  it("host 없음 → Error", async () => {
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "http_head" });
    expect(String(r)).toContain("Error");
  });

  it("http_head 성공 (https:// 없는 host)", async () => {
    mock_run.mockReturnValueOnce(ok("HTTP/2 200\ncontent-type: text/html"));
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "http_head", host: "example.com" });
    expect(r).toContain("200");
  });

  it("http_head 성공 (https:// 있는 host)", async () => {
    mock_run.mockReturnValueOnce(ok("HTTP/2 301\nlocation: https://www.example.com"));
    const r = await new NetworkTool({ workspace: WS }).execute({
      operation: "http_head", host: "https://example.com",
    });
    expect(r).toContain("301");
  });
});

describe("NetworkTool — netstat", () => {
  it("netstat 성공", async () => {
    mock_run.mockReturnValueOnce(ok("LISTEN 0.0.0.0:3000"));
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "netstat" });
    expect(r).toContain("3000");
  });
});

describe("NetworkTool — 취소/default/빈출력", () => {
  it("취소 신호 → Error: cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await new NetworkTool({ workspace: WS }).execute(
      { operation: "netstat" },
      { signal: ctrl.signal } as any,
    );
    expect(String(r)).toContain("cancelled");
  });

  it("unsupported operation → Error", async () => {
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });

  it("출력 없음 → (no output)", async () => {
    mock_run.mockReturnValueOnce(ok(""));
    const r = await new NetworkTool({ workspace: WS }).execute({ operation: "netstat" });
    expect(r).toContain("no output");
  });
});
