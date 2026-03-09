/**
 * ContainerCodeRunner — 미커버 분기 보충.
 * L25-30: ruby/bash/go/rust/deno/bun file_cmd 함수
 * L102: 지원하지 않는 언어 → throw
 */
import { describe, it, expect } from "vitest";
import { get_container_runtime } from "@src/agent/nodes/container-code-runner.js";

// ══════════════════════════════════════════
// L25-30: file_cmd 함수 (ruby, bash, go, rust, deno, bun)
// ══════════════════════════════════════════

describe("get_container_runtime — file_cmd (L25-30)", () => {
  it("ruby: file_cmd → ['ruby', filename]", () => {
    const rt = get_container_runtime("ruby" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("script.rb");
    expect(cmd).toEqual(["ruby", "script.rb"]);
  });

  it("bash: file_cmd → ['bash', filename]", () => {
    const rt = get_container_runtime("bash" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("script.sh");
    expect(cmd).toEqual(["bash", "script.sh"]);
  });

  it("go: file_cmd → ['go', 'run', filename]", () => {
    const rt = get_container_runtime("go" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("main.go");
    expect(cmd).toEqual(["go", "run", "main.go"]);
  });

  it("rust: file_cmd → ['bash', '-c', 'rustc ...']", () => {
    const rt = get_container_runtime("rust" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("main.rs");
    expect(cmd[0]).toBe("bash");
    expect(cmd[2]).toContain("rustc");
  });

  it("deno: file_cmd → ['deno', 'run', '--allow-all', filename]", () => {
    const rt = get_container_runtime("deno" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("script.ts");
    expect(cmd).toEqual(["deno", "run", "--allow-all", "script.ts"]);
  });

  it("bun: file_cmd → ['bun', 'run', filename]", () => {
    const rt = get_container_runtime("bun" as any);
    expect(rt).not.toBeNull();
    const cmd = rt!.file_cmd("script.ts");
    expect(cmd).toEqual(["bun", "run", "script.ts"]);
  });
});
