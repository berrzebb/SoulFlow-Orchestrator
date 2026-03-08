import { describe, it, expect } from "vitest";
import { format_handler } from "../../../src/agent/nodes/format.js";
import type { FormatNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("format_handler", () => {
  const createMockNode = (overrides?: Partial<FormatNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "format",
    operation: "number",
    value: "1234.56",
    locale: "en-US",
    currency: "USD",
    decimals: 2,
    mask_type: "custom",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be format", () => {
    expect(format_handler.node_type).toBe("format");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(format_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Formatted value" },
      { name: "success", type: "boolean", description: "Whether formatting succeeded" },
    ]);
  });

  it("metadata: input_schema should have operation and value", () => {
    expect(format_handler.input_schema).toEqual([
      { name: "operation", type: "string", description: "number/currency/percent/bytes/relative_time/mask/..." },
      { name: "value", type: "string", description: "Value to format" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = format_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "number",
      value: "",
      locale: "en-US",
      currency: "USD",
      decimals: 2,
      mask_type: "custom",
    });
  });

  it("execute: should handle number formatting", async () => {
    const node = createMockNode({ operation: "number", value: "1234.56" });
    const ctx = createMockContext();
    const result = await format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in value", async () => {
    const node = createMockNode({ operation: "number", value: "${amount}" });
    const ctx = createMockContext({ amount: "5000" });
    const result = await format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if value is empty", () => {
    const node = createMockNode({ value: "" });
    const result = format_handler.test(node);
    expect(result.warnings).toContain("value is required");
  });

  it("test validation: should warn if value is whitespace only", () => {
    const node = createMockNode({ value: "   " });
    const result = format_handler.test(node);
    expect(result.warnings).toContain("value is required");
  });

  it("test: preview should contain operation", () => {
    const node = createMockNode({ operation: "currency" });
    const result = format_handler.test(node);
    expect(result.preview).toEqual({ operation: "currency" });
  });

  it("execute: should handle missing operation (default to number)", async () => {
    const node = createMockNode({ operation: undefined });
    const ctx = createMockContext();
    const result = await format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing value (default to empty string)", async () => {
    const node = createMockNode({ value: undefined });
    const ctx = createMockContext();
    const result = await format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ operation: "invalid", value: "test" });
    const ctx = createMockContext();
    const result = await format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
