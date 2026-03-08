import { describe, it, expect } from "vitest";
import { markdown_handler } from "../../../src/agent/nodes/markdown.js";
import type { MarkdownNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("markdown_handler", () => {
  const createMockNode = (overrides?: Partial<MarkdownNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "markdown",
    operation: "table",
    data: "test",
    text: "",
    columns: "col1,col2",
    ordered: false,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be markdown", () => {
    expect(markdown_handler.node_type).toBe("markdown");
  });

  it("metadata: output_schema should have result and success", () => {
    expect(markdown_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Generated markdown" },
      { name: "success", type: "boolean", description: "Whether generation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = markdown_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "table",
      data: "",
      text: "",
      columns: "",
      ordered: false,
    });
  });

  it("execute: should handle table operation", async () => {
    const node = createMockNode({ operation: "table", data: "test" });
    const ctx = createMockContext();
    const result = await markdown_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in data", async () => {
    const node = createMockNode({ operation: "list", data: "${items}" });
    const ctx = createMockContext({ items: "item1,item2" });
    const result = await markdown_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain operation", () => {
    const node = createMockNode({ operation: "checklist" });
    const result = markdown_handler.test(node);
    expect(result.preview).toEqual({ operation: "checklist" });
  });

  it("execute: should handle list operation", async () => {
    const node = createMockNode({ operation: "list" });
    const ctx = createMockContext();
    const result = await markdown_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle checklist operation", async () => {
    const node = createMockNode({ operation: "checklist", ordered: true });
    const ctx = createMockContext();
    const result = await markdown_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ operation: "invalid" });
    const ctx = createMockContext();
    const result = await markdown_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
