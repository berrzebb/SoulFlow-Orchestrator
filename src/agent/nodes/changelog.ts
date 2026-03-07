/** Changelog 노드 핸들러 — 워크플로우에서 Conventional Commits 파싱/체인지로그 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { ChangelogNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const changelog_handler: NodeHandler = {
  node_type: "changelog",
  icon: "\u{1F4DD}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Changelog operation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse_commits / generate / group_by_type / validate_commit" },
    { name: "commits", type: "string", description: "JSON array of commit messages" },
  ],
  create_default: () => ({ action: "parse_commits", commits: "[]" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ChangelogNodeDefinition;
    try {
      const { ChangelogTool } = await import("../tools/changelog.js");
      const tool = new ChangelogTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse_commits",
        commits: n.commits ? resolve_templates(n.commits, tpl) : undefined,
        version: n.version ? resolve_templates(n.version, tpl) : undefined,
        message: n.commit_message ? resolve_templates(n.commit_message, tpl) : undefined,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ChangelogNodeDefinition;
    const warnings: string[] = [];
    if (n.action !== "validate_commit" && !n.commits) warnings.push("commits data is required");
    return { preview: { action: n.action, version: n.version }, warnings };
  },
};
