import { describe, it, expect } from "vitest";
import { changelog_handler } from "../../../src/agent/nodes/changelog.js";
import type { ChangelogNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("changelog_handler", () => {
  const createMockNode = (overrides?: Partial<ChangelogNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "changelog",
    action: "parse_commits",
    commits: '["feat: add feature"]',
    version: "1.0.0",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be changelog", () => {
    expect(changelog_handler.node_type).toBe("changelog");
  });

  it("metadata: output_schema should have result field", () => {
    expect(changelog_handler.output_schema).toEqual([
      { name: "result", type: "unknown", description: "Changelog operation result" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = changelog_handler.create_default?.();
    expect(defaults).toEqual({
      action: "parse_commits",
      commits: "[]",
    });
  });

  it("execute: should handle parse_commits action", async () => {
    const node = createMockNode({ action: "parse_commits", commits: '["feat: new feature"]' });
    const ctx = createMockContext();
    const result = await changelog_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
  });

  it("execute: should resolve templates in commits", async () => {
    const node = createMockNode({ action: "parse_commits", commits: "${commit_list}" });
    const ctx = createMockContext({ commit_list: '["fix: bug fix"]' });
    const result = await changelog_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in version", async () => {
    const node = createMockNode({ action: "generate", version: "${app_version}" });
    const ctx = createMockContext({ app_version: "2.0.0" });
    const result = await changelog_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if commits missing for non-validate action", () => {
    const node = createMockNode({ action: "parse_commits", commits: undefined });
    const result = changelog_handler.test(node);
    expect(result.warnings).toContain("commits data is required");
  });

  it("test validation: should not warn if action is validate_commit without commits", () => {
    const node = createMockNode({ action: "validate_commit", commits: undefined });
    const result = changelog_handler.test(node);
    expect(result.warnings).not.toContain("commits data is required");
  });

  it("test: preview should contain action and version", () => {
    const node = createMockNode({ action: "generate", version: "1.5.0" });
    const result = changelog_handler.test(node);
    expect(result.preview).toEqual({ action: "generate", version: "1.5.0" });
  });

  it("execute: should handle missing action (default to parse_commits)", async () => {
    const node = createMockNode({ action: undefined });
    const ctx = createMockContext();
    const result = await changelog_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ action: "parse_commits", commits: "invalid" });
    const ctx = createMockContext();
    const result = await changelog_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
