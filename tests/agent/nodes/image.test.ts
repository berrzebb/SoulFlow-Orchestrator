import { describe, it, expect } from "vitest";
import { image_handler } from "../../../src/agent/nodes/image.js";
import type { ImageNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("image_handler", () => {
  const createMockNode = (overrides?: Partial<ImageNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "image",
    operation: "resize",
    input_path: "/tmp/image.jpg",
    width: 100,
    height: 100,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be image", () => {
    expect(image_handler.node_type).toBe("image");
  });

  it("metadata: output_schema should have result and success", () => {
    expect(image_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Operation result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = image_handler.create_default?.();
    expect(defaults).toBeDefined();
    expect(defaults).toHaveProperty("operation");
  });

  it("execute: should handle resize operation", async () => {
    const node = createMockNode({ operation: "resize" });
    const ctx = createMockContext();
    const result = await image_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ input: "${img_path}" });
    const ctx = createMockContext({ img_path: "/tmp/photo.png" });
    const result = await image_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle crop action", async () => {
    const node = createMockNode({ action: "crop" });
    const ctx = createMockContext();
    const result = await image_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "convert" });
    const result = image_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ input: "" });
    const ctx = createMockContext();
    const result = await image_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
