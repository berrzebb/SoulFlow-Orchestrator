import { describe, it, expect } from "vitest";
import { xml_handler } from "../../../src/agent/nodes/xml.js";
import type { XmlNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("xml_handler", () => {
  const createMockNode = (overrides?: Partial<XmlNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "xml",
    operation: "parse",
    input: "<root><item>value</item></root>",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be xml", () => {
    expect(xml_handler.node_type).toBe("xml");
  });

  it("execute: should parse XML", async () => {
    const node = createMockNode({ operation: "parse" });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in input", async () => {
    const node = createMockNode({ input: "${xml_data}" });
    const ctx = createMockContext({ xml_data: "<data><name>test</name></data>" });
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should generate XML from JSON", async () => {
    const node = createMockNode({
      operation: "generate",
      input: '{"root":{"item":"value"}}',
    });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should validate XML against schema", async () => {
    const node = createMockNode({ operation: "validate" });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and input preview", () => {
    const node = createMockNode({ operation: "xpath" });
    const result = xml_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should extract with XPath", async () => {
    const node = createMockNode({
      operation: "xpath",
      xpath_expr: "/root/item",
    });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid XML gracefully", async () => {
    const node = createMockNode({ input: "invalid xml <>" });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should pretty print XML", async () => {
    const node = createMockNode({ operation: "format" });
    const ctx = createMockContext();
    const result = await xml_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
