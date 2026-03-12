/**
 * ToolInstallerService — 미커버 분기 (cov2):
 * - L57: existing.find() 콜백 — 기존 도구 존재 시 이름 비교 콜백 실행
 * - L58: exists && !input.overwrite → { installed: false, reason: "tool_already_exists" }
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolInstallerService } from "@src/agent/tools/installer.js";

let ws: string | null = null;

afterEach(() => {
  if (ws) {
    rmSync(ws, { recursive: true, force: true });
    ws = null;
  }
});

function make_installer() {
  ws = mkdtempSync(join(tmpdir(), "installer-cov2-"));
  return new ToolInstallerService(ws!);
}

const TOOL_INPUT = {
  name: "my_tool",
  description: "테스트 도구",
  parameters: { type: "object" as const, properties: {} },
  command_template: "echo hello",
};

describe("ToolInstallerService.install_shell_tool — L57/L58: 중복 설치 early return", () => {
  it("동일 이름 도구 재설치 (overwrite 없음) → L57 find callback 실행 + L58 early return", async () => {
    const installer = make_installer();

    // 첫 번째 설치 — 빈 existing → find callback 미호출
    const first = await installer.install_shell_tool(TOOL_INPUT);
    expect(first.installed).toBe(true);

    // 두 번째 설치 — existing에 my_tool 존재 → L57 find callback 실행 → exists=truthy
    // overwrite=undefined(!overwrite=true) → L58: return { installed: false, reason: "tool_already_exists" }
    const second = await installer.install_shell_tool(TOOL_INPUT);
    expect(second.installed).toBe(false);
    expect(second.reason).toBe("tool_already_exists");
  });

  it("overwrite=false 명시 + 기존 도구 존재 → L58 early return", async () => {
    const installer = make_installer();

    await installer.install_shell_tool(TOOL_INPUT);

    const result = await installer.install_shell_tool({ ...TOOL_INPUT, overwrite: false });
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("tool_already_exists");
  });

  it("overwrite=true + 기존 도구 존재 → L57 callback 실행, L58 skip → 덮어쓰기 성공", async () => {
    const installer = make_installer();

    await installer.install_shell_tool(TOOL_INPUT);

    // overwrite=true → L57 callback 실행되나 L58 조건 false → 덮어쓰기
    const result = await installer.install_shell_tool({ ...TOOL_INPUT, description: "수정된 도구", overwrite: true });
    expect(result.installed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
