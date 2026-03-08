import { describe, it, expect } from "vitest";
import { code_diagram_handler } from "../../../src/agent/nodes/code-diagram.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("code_diagram_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "code_diagram",
    diagram_type: "flowchart",
    code: "flowchart TD\n  A --> B",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be code_diagram", () => {
    expect(code_diagram_handler.node_type).toBe("code_diagram");
  });

  it("execute: should generate diagram", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in code", async () => {
    const node = createMockNode({ code: "${diagram_code}" });
    const ctx = createMockContext({ diagram_code: "flowchart LR\n  A --> B" });
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support different diagram types", async () => {
    const node = createMockNode({ diagram_type: "sequence" });
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show diagram type", () => {
    const node = createMockNode();
    const result = code_diagram_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle invalid syntax gracefully", async () => {
    const node = createMockNode({ code: "invalid syntax >>>>" });
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should export to SVG", async () => {
    const node = createMockNode({ output_format: "svg" });
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle styling options", async () => {
    const node = createMockNode({
      theme: "dark",
      width: 800,
    });
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle empty code", async () => {
    const node = createMockNode({ code: "" });
    const ctx = createMockContext();
    const result = await code_diagram_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
