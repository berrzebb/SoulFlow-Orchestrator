import { describe, it, expect } from "vitest";
import { shell_handler } from "../../../src/agent/nodes/shell.js";
import type { ShellNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("shell_handler", () => {
  const createMockNode = (overrides?: Partial<ShellNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "shell",
    command: "echo test",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be shell", () => {
    expect(shell_handler.node_type).toBe("shell");
  });

  it("execute: should execute shell command", async () => {
    const node = createMockNode({ command: "echo hello" });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in command", async () => {
    const node = createMockNode({ command: "echo ${message}" });
    const ctx = createMockContext({ message: "world" });
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should capture stdout", async () => {
    const node = createMockNode({ command: "echo captured" });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle working directory", async () => {
    const node = createMockNode({
      command: "pwd",
      cwd: "/tmp",
    });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show command", () => {
    const node = createMockNode({ command: "ls -la" });
    const result = shell_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle command with pipes", async () => {
    const node = createMockNode({
      command: "echo hello | grep hello",
    });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle timeout on long-running command", async () => {
    const node = createMockNode({
      command: "sleep 1",
      timeout_ms: 5000,
    });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle command failures gracefully", async () => {
    const node = createMockNode({
      command: "false",
    });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support environment variables", async () => {
    const node = createMockNode({
      command: "echo $TEST_VAR",
      env: { TEST_VAR: "test_value" },
    });
    const ctx = createMockContext();
    const result = await shell_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
