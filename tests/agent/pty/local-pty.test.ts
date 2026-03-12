import { describe, it, expect, vi } from "vitest";
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

/* ── Exited-state guard path tests ── */

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

describe("LocalPty — write() after exit is no-op", () => {
  it("프로세스 종료 후 write 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    expect(() => pty.write("data\n")).not.toThrow();
  });
});

describe("LocalPty — end() after exit is no-op", () => {
  it("프로세스 종료 후 end() 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    expect(() => pty.end()).not.toThrow();
  });

  it("프로세스 종료 후 end(data) 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    expect(() => pty.end("final data\n")).not.toThrow();
  });
});

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

describe("LocalPty — kill() after exit is no-op", () => {
  it("프로세스 종료 후 kill() 호출해도 에러 없음", async () => {
    const pty = make_pty("process.exit(0)");
    await wait_exit(pty);
    expect(() => pty.kill()).not.toThrow();
  });
});

describe("LocalPty — onData dispose", () => {
  it("dispose 후 데이터 수신 안 됨", async () => {
    const pty = make_pty('setTimeout(() => { process.stdout.write("hello"); process.exit(0); }, 50)');
    const chunks: string[] = [];
    const d = pty.onData((c) => chunks.push(c));
    d.dispose();
    await wait_exit(pty);
    expect(chunks).toHaveLength(0);
  });
});

describe("LocalPty — onExit dispose", () => {
  it("dispose 후 exit 콜백 호출 안 됨", async () => {
    const pty = make_pty("process.exit(0)");
    const calls: number[] = [];
    const d = pty.onExit((e) => calls.push(e.exitCode));
    d.dispose();
    await wait_exit(pty);
    expect(calls).toHaveLength(0);
  });
});
