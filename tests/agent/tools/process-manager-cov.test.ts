/**
 * process-manager.ts — 미커버 분기 (cov):
 * - L46: run_shell_command 예외 → catch → "Error: ..." 반환
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn().mockRejectedValue(new Error("shell execution failed")),
}));

import { ProcessManagerTool } from "@src/agent/tools/process-manager.js";

// ── L46: run_shell_command 예외 → catch ──────────────────────────────────────

describe("ProcessManagerTool — L46: shell 예외 → catch", () => {
  it("list op → run_shell_command 예외 → L46 catch → Error 반환", async () => {
    const tool = new ProcessManagerTool({ workspace: "/tmp" });
    const result = await tool.execute({ operation: "list", filter: "" });
    expect(String(result)).toContain("Error");
    expect(String(result)).toContain("shell execution failed");
  });
});
