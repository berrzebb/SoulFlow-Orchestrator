import { describe, it, expect } from "vitest";
import { password_handler } from "../../../src/agent/nodes/password.js";
import type { PasswordNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("password_handler", () => {
  const createMockNode = (overrides?: Partial<PasswordNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "password",
    action: "generate",
    password_input: "test123",
    length: 16,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be password", () => {
    expect(password_handler.node_type).toBe("password");
  });

  it("metadata: output_schema should have result field", () => {
    expect(password_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "Password operation result" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = password_handler.create_default?.();
    expect(defaults).toEqual({ action: "generate", length: 16 });
  });

  it("execute: should handle generate action", async () => {
    const node = createMockNode({ action: "generate", length: 20 });
    const ctx = createMockContext();
    const result = await password_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in password_input", async () => {
    const node = createMockNode({ action: "strength", password_input: "${pwd}" });
    const ctx = createMockContext({ pwd: "MyPassword123!" });
    const result = await password_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if password_input missing for strength check", () => {
    const node = createMockNode({ action: "strength", password_input: undefined });
    const result = password_handler.test(node);
    expect(result.warnings).toContain("password_input is required for strength check");
  });

  it("test: preview should contain action", () => {
    const node = createMockNode({ action: "hash" });
    const result = password_handler.test(node);
    expect(result.preview).toEqual({ action: "hash" });
  });

  it("execute: should handle strength action", async () => {
    const node = createMockNode({ action: "strength", password_input: "test" });
    const ctx = createMockContext();
    const result = await password_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle hash action", async () => {
    const node = createMockNode({ action: "hash", password_input: "secret" });
    const ctx = createMockContext();
    const result = await password_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "generate", length: undefined });
    const ctx = createMockContext();
    const result = await password_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
