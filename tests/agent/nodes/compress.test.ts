import { describe, it, expect } from "vitest";
import { compress_handler } from "../../../src/agent/nodes/compress.js";
import type { CompressNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("compress_handler", () => {
  const createMockNode = (overrides?: Partial<CompressNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "compress",
    operation: "compress",
    input_path: "/tmp/file.txt",
    output_path: "/tmp/file.gz",
    input: "",
    algorithm: "gzip",
    level: 6,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be compress", () => {
    expect(compress_handler.node_type).toBe("compress");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(compress_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Compression result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = compress_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "compress",
      input_path: "",
      output_path: "",
      input: "",
      algorithm: "gzip",
      level: 6,
    });
  });

  it("execute: should handle compress operation", async () => {
    const node = createMockNode({ operation: "compress", input_path: "/tmp/file.txt" });
    const ctx = createMockContext();
    const result = await compress_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in input_path", async () => {
    const node = createMockNode({ operation: "compress", input_path: "${path}" });
    const ctx = createMockContext({ path: "/tmp/data.txt" });
    const result = await compress_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if input_path missing for file operations", () => {
    const node = createMockNode({ operation: "compress", input_path: "" });
    const result = compress_handler.test(node);
    expect(result.warnings).toContain("input_path is required for file operations");
  });

  it("test validation: should warn if input missing for string operations", () => {
    const node = createMockNode({ operation: "compress_string", input: "" });
    const result = compress_handler.test(node);
    expect(result.warnings).toContain("input is required for string operations");
  });

  it("test: preview should contain operation and algorithm", () => {
    const node = createMockNode({ operation: "compress", algorithm: "gzip" });
    const result = compress_handler.test(node);
    expect(result.preview).toEqual({ operation: "compress", algorithm: "gzip" });
  });

  it("execute: should handle decompress operation", async () => {
    const node = createMockNode({ operation: "decompress", input_path: "/tmp/file.gz" });
    const ctx = createMockContext();
    const result = await compress_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing operation (default to compress)", async () => {
    const node = createMockNode({ operation: undefined });
    const ctx = createMockContext();
    const result = await compress_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
