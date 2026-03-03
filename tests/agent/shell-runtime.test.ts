import { describe, it, expect } from "vitest";
import { needs_native_shell } from "@src/agent/tools/shell-runtime.ts";

describe("needs_native_shell", () => {
  const is_win = process.platform === "win32";

  it("powershell 명령을 감지한다", () => {
    const result = needs_native_shell("powershell -ExecutionPolicy Bypass -File script.ps1");
    expect(result).toBe(is_win);
  });

  it("pwsh 명령을 감지한다", () => {
    expect(needs_native_shell("pwsh -File test.ps1")).toBe(is_win);
  });

  it("powershell.exe 명령을 감지한다", () => {
    expect(needs_native_shell("powershell.exe -Command Get-Process")).toBe(is_win);
  });

  it("선행 공백이 있어도 감지한다", () => {
    expect(needs_native_shell("  powershell -File test.ps1")).toBe(is_win);
  });

  it("일반 명령은 false를 반환한다", () => {
    expect(needs_native_shell("echo hello")).toBe(false);
    expect(needs_native_shell("ls -la")).toBe(false);
    expect(needs_native_shell("npm install")).toBe(false);
  });

  it("powershell이 인자에만 있으면 false", () => {
    expect(needs_native_shell("echo powershell is great")).toBe(false);
  });
});
