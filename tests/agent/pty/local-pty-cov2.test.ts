/**
 * LocalPty — exited 상태에서의 guard 경로 커버리지.
 * - write() when exited → no-op
 * - end() when exited → no-op
 * - end() with data → stdin.write 후 end()
 * - kill() when exited → no-op (SIGTERM 미호출)
 * - kill() → SIGKILL (3초 후)
 */
import { describe, it, expect, vi } from "vitest";
import { LocalPty } from "@src/agent/pty/local-pty.ts";

function make_pty(script: string): LocalPty {
  return new LocalPty("node", ["-e", script], {
    name: "test",
    cwd: process.cwd(),
    env: {},
  });
}

async function wait_exit(pty: LocalPty): Promise<number> {
  return new Promise((resolve) => {
    pty.onExit((e) => resolve(e.exitCode));
  });
}

// ══════════════════════════════════════════
// write() — exited 상태 → no-op
// ══════════════════════════════════════════

describe("LocalPty — write() after exit is no-op", () => {
  it("프로세스 종료 후 write 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    // 종료 상태에서 write → early return (exited=true guard)
    expect(() => pty.write("data\n")).not.toThrow();
  });
});

// ══════════════════════════════════════════
// end() — exited 상태 → no-op
// ══════════════════════════════════════════

describe("LocalPty — end() after exit is no-op", () => {
  it("프로세스 종료 후 end() 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    // exited=true guard → early return
    expect(() => pty.end()).not.toThrow();
  });

  it("프로세스 종료 후 end(data) 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    expect(() => pty.end("final data\n")).not.toThrow();
  });
});

// ══════════════════════════════════════════
// end() with data — 살아있는 프로세스
// ══════════════════════════════════════════

describe("LocalPty — end(data) 살아있는 프로세스", () => {
  it("data 있는 end() → stdin.write + stdin.end 호출", async () => {
    const pty = make_pty(`
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (l) => process.stdout.write("got:" + l + "\\n"));
      rl.on("close", () => process.exit(0));
    `);
    const chunks: string[] = [];
    pty.onData((d) => chunks.push(d));
    await new Promise((r) => setTimeout(r, 100));
    pty.end("end-data\n");
    await wait_exit(pty);
    expect(chunks.join("")).toContain("got:end-data");
  });
});

// ══════════════════════════════════════════
// kill() — exited 상태 → no-op
// ══════════════════════════════════════════

describe("LocalPty — kill() after exit is no-op", () => {
  it("프로세스 종료 후 kill() 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    // exited=true guard → return immediately, SIGTERM 미호출
    expect(() => pty.kill()).not.toThrow();
  });
});

// ══════════════════════════════════════════
// onData dispose — 리스너 제거
// ══════════════════════════════════════════

describe("LocalPty — onData dispose", () => {
  it("dispose 후 데이터 수신 안 됨", async () => {
    const pty = make_pty('setTimeout(() => { process.stdout.write("hello"); process.exit(0); }, 50)');
    const chunks: string[] = [];
    const d = pty.onData((c) => chunks.push(c));
    d.dispose();
    await wait_exit(pty);
    // dispose 후이므로 수신 없음
    expect(chunks).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// onExit dispose — 리스너 제거
// ══════════════════════════════════════════

describe("LocalPty — onExit dispose", () => {
  it("dispose 후 exit 콜백 호출 안 됨", async () => {
    const pty = make_pty("process.exit(0)");
    const calls: number[] = [];
    const d = pty.onExit((e) => calls.push(e.exitCode));
    d.dispose();
    // 종료 이벤트 기다리기
    await wait_exit(pty);
    // dispose했으므로 calls 비어있어야 함
    expect(calls).toHaveLength(0);
  });
});
