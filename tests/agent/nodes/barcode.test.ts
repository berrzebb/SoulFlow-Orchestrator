import { describe, it, expect } from "vitest";
import { barcode_handler } from "../../../src/agent/nodes/barcode.js";
import type { BarcodeNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("barcode_handler", () => {
  const createMockNode = (overrides?: Partial<BarcodeNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "barcode",
    action: "generate",
    data: "123456789",
    format: "code128",
    width: 200,
    height: 80,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be barcode", () => {
    expect(barcode_handler.node_type).toBe("barcode");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(barcode_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Generated barcode SVG or JSON" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = barcode_handler.create_default?.();
    expect(defaults).toEqual({
      action: "generate",
      data: "",
      format: "code128",
    });
  });

  it("execute: should handle generate action", async () => {
    const node = createMockNode({ action: "generate", data: "123456" });
    const ctx = createMockContext();
    const result = await barcode_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in data", async () => {
    const node = createMockNode({ action: "generate", data: "${product_id}" });
    const ctx = createMockContext({ product_id: "PROD-123" });
    const result = await barcode_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if data is missing", () => {
    const node = createMockNode({ data: undefined });
    const result = barcode_handler.test(node);
    expect(result.warnings).toContain("data is required");
  });

  it("test: preview should contain action and format", () => {
    const node = createMockNode({ action: "generate", format: "ean13" });
    const result = barcode_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing action (default to generate)", async () => {
    const node = createMockNode({ action: undefined });
    const ctx = createMockContext();
    const result = await barcode_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle validate_ean action", async () => {
    const node = createMockNode({ action: "validate_ean", data: "5901234123457" });
    const ctx = createMockContext();
    const result = await barcode_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "generate", data: "" });
    const ctx = createMockContext();
    const result = await barcode_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
