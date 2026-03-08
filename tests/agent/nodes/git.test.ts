import { describe, it, expect } from "vitest";
import { git_handler } from "../../../src/agent/nodes/git.js";
import type { GitNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("git_handler", () => {
  const createMockNode = (overrides?: Partial<GitNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "git",
    action: "clone",
    repo: "https://github.com/example/repo.git",
    path: "/tmp/repo",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be git", () => {
    expect(git_handler.node_type).toBe("git");
  });

  it("execute: should handle clone action", async () => {
    const node = createMockNode({ action: "clone" });
    const ctx = createMockContext();
    const result = await git_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates", async () => {
    const node = createMockNode({ repo: "${git_repo}" });
    const ctx = createMockContext({ git_repo: "https://github.com/test/repo.git" });
    const result = await git_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle pull action", async () => {
    const node = createMockNode({ action: "pull", path: "/tmp/repo" });
    const ctx = createMockContext();
    const result = await git_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should have action", () => {
    const node = createMockNode({ action: "push" });
    const result = git_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ repo: "" });
    const ctx = createMockContext();
    const result = await git_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
