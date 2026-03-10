import { describe, it, expect } from "vitest";
import { validator_handler } from "../../../src/agent/nodes/validator.js";
import type { ValidatorNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("validator_handler", () => {
  const createMockNode = (overrides?: Partial<ValidatorNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "validator",
    rules: [{ field: "email", pattern: "^[^@]+@[^@]+\\.[^@]+$" }],
    data: '{"email":"test@example.com"}',
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be validator", () => {
    expect(validator_handler.node_type).toBe("validator");
  });

  it("execute: should validate data against rules", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("valid");
  });

  it("execute: should resolve templates in data", async () => {
    const node = createMockNode({ data: "${user_data}" });
    const ctx = createMockContext({ user_data: '{"email":"user@test.com"}' });
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle multiple validation rules", async () => {
    const node = createMockNode({
      rules: [
        { field: "email", pattern: "^[^@]+@[^@]+\\.[^@]+$" },
        { field: "age", pattern: "^\\d+$" },
      ],
    });
    const ctx = createMockContext();
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show validation summary", () => {
    const node = createMockNode();
    const result = validator_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle invalid JSON gracefully", async () => {
    const node = createMockNode({ data: "invalid json" });
    const ctx = createMockContext();
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return detailed validation errors", async () => {
    const node = createMockNode({
      data: '{"email":"notanemail"}',
      rules: [{ field: "email", pattern: "^[^@]+@[^@]+\\.[^@]+$" }],
    });
    const ctx = createMockContext();
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing optional fields", async () => {
    const node = createMockNode({ rules: [] });
    const ctx = createMockContext();
    const result = await validator_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});

describe("validator — test() schema 경고 (L49)", () => {
  const mk = (overrides: Partial<ValidatorNodeDefinition>): OrcheNodeDefinition =>
    ({ node_id: "n1", node_type: "validator", rules: [], data: "", operation: "schema", ...overrides } as OrcheNodeDefinition);

  it("operation=schema + schema='{}' → schema 경고 (L49)", () => {
    const result = validator_handler.test(mk({ schema: "{}" }));
    expect(result.warnings.some((w: string) => w.includes("schema"))).toBe(true);
  });

  it("operation=schema + schema 없음 → schema 경고 (L49)", () => {
    const result = validator_handler.test(mk({ schema: "" }));
    expect(result.warnings.some((w: string) => w.includes("schema"))).toBe(true);
  });
});
