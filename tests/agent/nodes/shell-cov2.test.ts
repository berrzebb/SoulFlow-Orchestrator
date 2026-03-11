/**
 * shell_handler — 미커버 분기 (cov2):
 * - L51: working_dir 경로 순회 차단 — workspace 외부 접근
 */
import { describe, it, expect } from "vitest";
import { shell_handler } from "@src/agent/nodes/shell.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_ctx(workspace: string): OrcheNodeExecutorContext {
  return { memory: {}, workspace };
}

// ── L51: working_dir 경로 순회 차단 ──────────────────────────────────────────

describe("shell_handler — L51: working_dir path traversal 차단", () => {
  it("working_dir이 workspace 외부 경로 → error 반환 (L51)", async () => {
    const node = {
      node_id: "n1",
      node_type: "shell",
      command: "echo hello",
      working_dir: "/tmp/evil_path",  // /workspace/proj 외부
    } as any;
    const ctx = make_ctx("/workspace/proj");
    const result = await shell_handler.execute(node, ctx);
    expect(result.output.error).toBe("working_dir path traversal blocked");
    expect(result.output.exit_code).toBe(1);
  });

  it("working_dir이 workspace의 상위 디렉토리 → error 반환", async () => {
    const node = {
      node_id: "n2",
      node_type: "shell",
      command: "echo hello",
      working_dir: "/workspace",  // /workspace/proj 의 상위
    } as any;
    const ctx = make_ctx("/workspace/proj");
    const result = await shell_handler.execute(node, ctx);
    expect(result.output.error).toBe("working_dir path traversal blocked");
  });
});
