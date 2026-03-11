/**
 * LocalPty — L68: kill() → 3초 후 SIGKILL 커버리지.
 * - L68: setTimeout 콜백 내 if(!this.exited) → proc.kill("SIGKILL")
 *
 * child_process.spawn을 mock → 프로세스가 SIGTERM 무시 → 3초 타이머 발화 → SIGKILL.
 */
import { describe, it, expect, vi } from "vitest";

const mock_kill = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    pid: 9999,
    stdin: { writable: false },
    stdout: { setEncoding: vi.fn(), on: vi.fn() },
    stderr: { setEncoding: vi.fn(), on: vi.fn() },
    on: vi.fn(),   // exit 이벤트 절대 발생 안 함
    kill: mock_kill,
  }),
}));

import { LocalPty } from "@src/agent/pty/local-pty.js";

// ── L68: 3초 후 SIGKILL ────────────────────────────────────────────────────────

describe("LocalPty — L68: 3초 후 SIGKILL 발동", () => {
  it("kill() → SIGTERM 무시 → 3초 후 SIGKILL 전송 (L68)", async () => {
    vi.useFakeTimers();
    try {
      const pty = new LocalPty("node", ["-e", "process.on('SIGTERM', () => {})"], {
        name: "test",
        cwd: process.cwd(),
        env: {},
      });

      mock_kill.mockClear();

      // kill() 호출 → SIGTERM + setTimeout(3000) 등록
      pty.kill();
      expect(mock_kill).toHaveBeenCalledWith("SIGTERM");

      // exited=false 상태에서 3초 경과 → L68: proc.kill("SIGKILL")
      await vi.advanceTimersByTimeAsync(3001);
      expect(mock_kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
