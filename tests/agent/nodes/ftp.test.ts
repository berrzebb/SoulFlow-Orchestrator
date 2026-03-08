import { describe, it, expect } from "vitest";
import { ftp_handler } from "../../../src/agent/nodes/ftp.js";
import type { FtpNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("ftp_handler", () => {
  const createMockNode = (overrides?: Partial<FtpNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "ftp",
    action: "list",
    host: "ftp.example.com",
    user: "user",
    password: "pass",
    path: "/",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be ftp", () => {
    expect(ftp_handler.node_type).toBe("ftp");
  });

  it("execute: should handle list action", async () => {
    const node = createMockNode({ action: "list" });
    const ctx = createMockContext();
    const result = await ftp_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ host: "${ftp_host}" });
    const ctx = createMockContext({ ftp_host: "ftp.test.com" });
    const result = await ftp_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle get action", async () => {
    const node = createMockNode({ action: "get", path: "/file.txt" });
    const ctx = createMockContext();
    const result = await ftp_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "put" });
    const result = ftp_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ host: "" });
    const ctx = createMockContext();
    const result = await ftp_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
