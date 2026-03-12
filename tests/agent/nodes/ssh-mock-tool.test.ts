/**
 * ssh_handler — 미커버 분기 보충.
 * test(): host 누락 경고, exec+command 누락 경고.
 * execute(): JSON 파싱 분기(JSON 결과 vs 평문 결과), 에러 처리.
 */
import { describe, it, expect, vi } from "vitest";

// ── hoisted mock — execute() 반환값 제어 ─────────────────────────────────

const { mock_execute } = vi.hoisted(() => ({
  mock_execute: vi.fn().mockResolvedValue('{"success":true,"stdout":"ok"}'),
}));

vi.mock("@src/agent/tools/ssh.js", () => ({
  // 생성자 mock: 일반 function 사용 (arrow function은 new 시 warning 발생)
  SshTool: vi.fn(function () { return { execute: mock_execute }; }),
}));

import { ssh_handler } from "@src/agent/nodes/ssh.js";

// ══════════════════════════════════════════
// test() — warning 분기
// ══════════════════════════════════════════

describe("ssh_handler.test() — warning 분기", () => {
  it("host 없음 → 'host is required' warning", () => {
    const node = { node_id: "n", node_type: "ssh", host: "", action: "exec", command: "ls" };
    const result = ssh_handler.test(node);
    expect(result.warnings).toContain("host is required");
  });

  it("host 있음 → host warning 없음", () => {
    const node = { node_id: "n", node_type: "ssh", host: "user@host.com", action: "exec", command: "ls" };
    const result = ssh_handler.test(node);
    expect(result.warnings).not.toContain("host is required");
  });

  it("action=exec, command 없음 → 'command is required for exec' warning", () => {
    const node = { node_id: "n", node_type: "ssh", host: "host", action: "exec", command: "" };
    const result = ssh_handler.test(node);
    expect(result.warnings).toContain("command is required for exec");
  });

  it("action=exec, command 있음 → command warning 없음", () => {
    const node = { node_id: "n", node_type: "ssh", host: "host", action: "exec", command: "whoami" };
    const result = ssh_handler.test(node);
    expect(result.warnings).not.toContain("command is required for exec");
  });

  it("action=scp, command 없어도 → command warning 없음 (exec만 체크)", () => {
    const node = { node_id: "n", node_type: "ssh", host: "host", action: "scp", command: "" };
    const result = ssh_handler.test(node);
    expect(result.warnings).not.toContain("command is required for exec");
  });

  it("preview에 action, host 포함", () => {
    const node = { node_id: "n", node_type: "ssh", host: "my-host", action: "info" };
    const result = ssh_handler.test(node);
    expect(result.preview).toMatchObject({ action: "info", host: "my-host" });
  });
});

// ══════════════════════════════════════════
// execute() — JSON vs 평문 결과 분기
// ══════════════════════════════════════════

describe("ssh_handler.execute() — JSON vs 평문 결과 파싱", () => {
  const node = { node_id: "n", node_type: "ssh", action: "exec", host: "host", command: "ls" };
  const ctx = { memory: {} };

  it("tool이 JSON 반환 → parsed 객체로 output.result", async () => {
    mock_execute.mockResolvedValueOnce('{"success":true,"stdout":"parsed output"}');
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output.result).toMatchObject({ success: true, stdout: "parsed output" });
    expect(result.output.success).toBe(true);
  });

  it("tool이 평문 반환 → { stdout: 평문 } 래핑", async () => {
    mock_execute.mockResolvedValueOnce("plain text output");
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output.result).toMatchObject({ stdout: "plain text output" });
    expect(result.output.success).toBe(true);
  });

  it("JSON에 success:false → output.success=false", async () => {
    mock_execute.mockResolvedValueOnce('{"success":false,"error":"permission denied"}');
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output.success).toBe(false);
  });

  it("tool throw → output.result=null, success=false", async () => {
    mock_execute.mockRejectedValueOnce(new Error("connection refused"));
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output.result).toBeNull();
    expect(result.output.success).toBe(false);
  });
});
