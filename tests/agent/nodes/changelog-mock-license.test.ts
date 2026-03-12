/**
 * changelog.ts — 미커버 분기 보충:
 * - L51: LicenseTool.execute() 예외 → 외부 catch → { result: null }
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

vi.mock("@src/agent/tools/license.js", () => ({
  LicenseTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("license tool error")),
  })),
}));

import { changelog_handler } from "@src/agent/nodes/changelog.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

describe("changelog_handler — L51: LicenseTool throw → { result: null }", () => {
  it("LICENSE_OPS 중 LicenseTool가 예외 → 외부 catch → result: null (L51)", async () => {
    const node = {
      node_id: "n1",
      node_type: "changelog",
      action: "license_list",
      commits: "[]",
    } as unknown as OrcheNodeDefinition;

    const result = await changelog_handler.execute(node, make_ctx());
    expect(result.output.result).toBeNull();
  });
});
