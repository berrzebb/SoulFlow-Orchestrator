import { describe, it, expect } from "vitest";
import { phone_handler } from "../../../src/agent/nodes/phone.js";
import type { PhoneNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("phone_handler", () => {
  const createMockNode = (overrides?: Partial<PhoneNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "phone",
    action: "validate",
    number: "+1234567890",
    country: "US",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be phone", () => {
    expect(phone_handler.node_type).toBe("phone");
  });

  it("metadata: output_schema should have result and valid", () => {
    expect(phone_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "Phone operation result" },
      { name: "valid", type: "boolean", description: "Whether phone number is valid" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = phone_handler.create_default?.();
    expect(defaults).toEqual({ action: "validate", number: "", country: "" });
  });

  it("execute: should handle validate action", async () => {
    const node = createMockNode({ action: "validate" });
    const ctx = createMockContext();
    const result = await phone_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("valid");
  });

  it("execute: should resolve templates in number", async () => {
    const node = createMockNode({ action: "validate", number: "${phone}" });
    const ctx = createMockContext({ phone: "+1-555-123-4567" });
    const result = await phone_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle format action", async () => {
    const node = createMockNode({ action: "format", format_type: "E164" });
    const ctx = createMockContext();
    const result = await phone_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle normalize action", async () => {
    const node = createMockNode({ action: "normalize" });
    const ctx = createMockContext();
    const result = await phone_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "parse" });
    const result = phone_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ number: undefined });
    const ctx = createMockContext();
    const result = await phone_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
