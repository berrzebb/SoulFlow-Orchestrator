/**
 * document.ts — 미커버 분기 보충:
 * - L49: DocumentTool.execute() 예외 → catch → { output: "", size_bytes: 0, success: false }
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

vi.mock("@src/agent/tools/document.js", () => ({
  DocumentTool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockRejectedValue(new Error("document tool error")),
  })),
}));

import { document_docx_handler } from "@src/agent/nodes/document.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined };
}

describe("document_docx_handler — L49: DocumentTool throw → catch → empty output", () => {
  it("DocumentTool.execute() 예외 → catch → output: '', size_bytes: 0, success: false (L49)", async () => {
    const node = {
      node_id: "n1",
      node_type: "document_docx",
      content: "# Test",
      output: "/tmp/out.docx",
      input_format: "markdown",
    } as unknown as OrcheNodeDefinition;

    const result = await document_docx_handler.execute(node, make_ctx());
    expect(result.output.output).toBe("");
    expect(result.output.size_bytes).toBe(0);
    expect(result.output.success).toBe(false);
  });
});
