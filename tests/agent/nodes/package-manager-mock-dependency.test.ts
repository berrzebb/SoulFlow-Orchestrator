/**
 * package-manager.ts — 미커버 분기 (cov4):
 * - L53: DependencyTool.execute() 예외 → catch → { output: error_message, success: false }
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

vi.mock("@src/agent/tools/dependency.js", () => ({
  DependencyTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("dependency tool error")),
  })),
}));

import { package_manager_handler } from "@src/agent/nodes/package-manager.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

// ── L53: DependencyTool 예외 → catch ────────────────────────────────────────

describe("package_manager_handler — L53: DependencyTool throw → catch", () => {
  it("parse_deps op → DependencyTool.execute() 예외 → success: false (L53)", async () => {
    const node = {
      node_id: "n1",
      node_type: "package_manager",
      operation: "parse_deps",
      dep_input: "{}",
    } as unknown as OrcheNodeDefinition;

    const result = await package_manager_handler.execute(node, make_ctx());
    expect(result.output.success).toBe(false);
    expect(typeof result.output.output).toBe("string");
    expect(result.output.output).toContain("dependency tool error");
  });
});
