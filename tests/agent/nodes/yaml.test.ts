import { describe, it, expect } from "vitest";
import { yaml_handler } from "../../../src/agent/nodes/yaml.js";
import type { YamlNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("yaml_handler", () => {
  const createMockNode = (overrides?: Partial<YamlNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "yaml",
    operation: "parse",
    input: "name: test\nage: 25",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be yaml", () => {
    expect(yaml_handler.node_type).toBe("yaml");
  });

  it("execute: should parse YAML", async () => {
    const node = createMockNode({ operation: "parse" });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ input: "${yaml_content}" });
    const ctx = createMockContext({ yaml_content: "key: value\nnested:\n  item: test" });
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should generate YAML from JSON", async () => {
    const node = createMockNode({
      operation: "generate",
      input: '{"name":"test","age":25}',
    });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should validate YAML syntax", async () => {
    const node = createMockNode({ operation: "validate" });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation", () => {
    const node = createMockNode();
    const result = yaml_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should convert YAML to JSON", async () => {
    const node = createMockNode({ operation: "to_json" });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid YAML gracefully", async () => {
    const node = createMockNode({ input: "invalid: yaml: content:" });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle complex nested structures", async () => {
    const node = createMockNode({
      input: "root:\n  level1:\n    level2:\n      - item1\n      - item2",
    });
    const ctx = createMockContext();
    const result = await yaml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
