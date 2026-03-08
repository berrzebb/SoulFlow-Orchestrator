import { describe, it, expect } from "vitest";
import { data_format_handler } from "../../../src/agent/nodes/data-format.js";
import type { DataFormatNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("data_format_handler", () => {
  const createMockNode = (overrides?: Partial<DataFormatNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "data_format",
    operation: "convert",
    input: '{"key":"value"}',
    from: "json",
    to: "csv",
    path: "",
    keys: "",
    delimiter: ",",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be data_format", () => {
    expect(data_format_handler.node_type).toBe("data_format");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(data_format_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Converted/queried data" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = data_format_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "convert",
      input: "",
      from: "json",
      to: "csv",
      path: "",
      keys: "",
    });
  });

  it("execute: should handle convert operation", async () => {
    const node = createMockNode({ operation: "convert", input: '{"a":1}', from: "json", to: "csv" });
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ operation: "convert", input: "${data}", from: "json", to: "csv" });
    const ctx = createMockContext({ data: '{"test":123}' });
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in operation", async () => {
    const node = createMockNode({ operation: "${op}", input: '{}' });
    const ctx = createMockContext({ op: "convert" });
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain operation and formats", () => {
    const node = createMockNode({ operation: "convert", from: "json", to: "yaml" });
    const result = data_format_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing operation (default to convert)", async () => {
    const node = createMockNode({ operation: undefined });
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing input (default to empty string)", async () => {
    const node = createMockNode({ input: undefined });
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle query operation", async () => {
    const node = createMockNode({ operation: "query", input: '{"a":{"b":2}}', path: "a.b" });
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle flatten operation", async () => {
    const node = createMockNode({ operation: "flatten", input: '{"a":{"b":1}}' });
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
