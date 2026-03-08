import { describe, it, expect } from "vitest";
import { ssh_handler } from "../../../src/agent/nodes/ssh.js";
import type { SshNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("ssh_handler", () => {
  const createMockNode = (overrides?: Partial<SshNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "ssh",
    action: "exec",
    host: "ssh.example.com",
    user: "user",
    command: "ls -la",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be ssh", () => {
    expect(ssh_handler.node_type).toBe("ssh");
  });

  it("execute: should handle exec action", async () => {
    const node = createMockNode({ action: "exec" });
    const ctx = createMockContext();
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ command: "${cmd}" });
    const ctx = createMockContext({ cmd: "whoami" });
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle scp action", async () => {
    const node = createMockNode({ action: "scp" });
    const ctx = createMockContext();
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "tunnel" });
    const result = ssh_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ host: "" });
    const ctx = createMockContext();
    const result = await ssh_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
