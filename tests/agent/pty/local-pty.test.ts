import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { LocalPty, local_pty_factory } from "@src/agent/pty/local-pty.ts";

const FIXTURES_DIR = resolve(__dirname, "../../helpers");

describe("LocalPty", () => {
  it("프로세스를 spawn하고 stdout을 수신한다", async () => {
    const pty = new LocalPty("node", ["-e", 'process.stdout.write("hello\\n")'], {
      name: "test",
      cwd: process.cwd(),
      env: {},
    });

    const chunks: string[] = [];
    pty.onData((data) => chunks.push(data));

    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });

    expect(chunks.join("")).toContain("hello");
  });

  it("stdin으로 데이터를 전달한다", async () => {
    const pty = new LocalPty("node", ["-e", `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => { process.stdout.write("echo:" + line + "\\n"); rl.close(); process.exit(0); });
    `], {
      name: "test-stdin",
      cwd: process.cwd(),
      env: {},
    });

    const chunks: string[] = [];
    pty.onData((data) => chunks.push(data));

    // stdin이 준비될 때까지 짧은 대기
    await new Promise((r) => setTimeout(r, 100));
    pty.write("ping\n");

    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });

    expect(chunks.join("")).toContain("echo:ping");
  });

  it("종료 코드를 전달한다", async () => {
    const pty = new LocalPty("node", ["-e", "process.exit(42)"], {
      name: "test-exit",
      cwd: process.cwd(),
      env: {},
    });

    const exit_code = await new Promise<number>((resolve) => {
      pty.onExit((e) => resolve(e.exitCode));
    });

    expect(exit_code).toBe(42);
  });

  it("kill로 프로세스를 종료한다", async () => {
    const pty = new LocalPty("node", ["-e", "setTimeout(() => {}, 60000)"], {
      name: "test-kill",
      cwd: process.cwd(),
      env: {},
    });

    const exit_promise = new Promise<number>((resolve) => {
      pty.onExit((e) => resolve(e.exitCode));
    });

    pty.kill();
    const code = await exit_promise;
    expect(code).not.toBe(0);
  });

  it("환경변수를 주입한다", async () => {
    const pty = new LocalPty("node", ["-e", 'process.stdout.write(process.env.MY_VAR || "missing")'], {
      name: "test-env",
      cwd: process.cwd(),
      env: { MY_VAR: "injected_value" },
    });

    const chunks: string[] = [];
    pty.onData((data) => chunks.push(data));

    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });

    expect(chunks.join("")).toContain("injected_value");
  });

  it("local_pty_factory가 Pty 인스턴스를 반환한다", async () => {
    const pty = local_pty_factory("node", ["-e", "process.exit(0)"], {
      name: "factory-test",
      cwd: process.cwd(),
      env: {},
    });

    expect(pty.pid).toBeDefined();
    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });
  });

  it("stderr 출력을 data 리스너로 수신한다 (L29)", async () => {
    const pty = new LocalPty("node", ["-e", 'process.stderr.write("err_output\\n"); process.exit(0)'], {
      name: "test-stderr",
      cwd: process.cwd(),
      env: {},
    });

    const chunks: string[] = [];
    pty.onData((data) => chunks.push(data));

    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });

    expect(chunks.join("")).toContain("err_output");
  });

  it("이미 종료된 프로세스의 onExit는 즉시 콜백을 호출한다", async () => {
    const pty = new LocalPty("node", ["-e", ""], {
      name: "test-immediate-exit",
      cwd: process.cwd(),
      env: {},
    });

    // 프로세스 종료 대기
    await new Promise<void>((resolve) => {
      pty.onExit(() => resolve());
    });

    // 이미 종료된 상태에서 onExit 등록
    const code = await new Promise<number>((resolve) => {
      pty.onExit((e) => resolve(e.exitCode));
    });
    expect(code).toBe(0);
  });
});
