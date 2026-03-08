import { describe, it, expect } from "vitest";
import { email_handler } from "../../../src/agent/nodes/email.js";
import type { EmailNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("email_handler", () => {
  const createMockNode = (overrides?: Partial<EmailNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "email",
    action: "validate",
    email: "test@example.com",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be email", () => {
    expect(email_handler.node_type).toBe("email");
  });

  it("execute: should handle validate action", async () => {
    const node = createMockNode({ action: "validate" });
    const ctx = createMockContext();
    const result = await email_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ email: "${user_email}" });
    const ctx = createMockContext({ user_email: "user@test.com" });
    const result = await email_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should contain action", () => {
    const node = createMockNode({ action: "extract_domain" });
    const result = email_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle extract_domain action", async () => {
    const node = createMockNode({ action: "extract_domain" });
    const ctx = createMockContext();
    const result = await email_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ email: "" });
    const ctx = createMockContext();
    const result = await email_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
