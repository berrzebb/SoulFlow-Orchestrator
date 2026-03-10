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
  create_default: () => ({ action: "parse_commits", commits: "[]", license_id: "MIT", license_id2: "", license_author: "", license_year: String(new Date().getFullYear()), license_text: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ChangelogNodeDefinition;
    const tpl = { memory: ctx.memory };

    // 라이선스 연산은 LicenseTool로 위임
    const LICENSE_OPS = ["license_generate", "license_detect", "license_info", "license_compare", "license_list", "license_compatible"];
    if (LICENSE_OPS.includes(n.action || "")) {
      try {
        const { LicenseTool } = await import("../tools/license.js");
        const tool = new LicenseTool();
        const action_map: Record<string, string> = {
          license_generate: "generate", license_detect: "detect",
          license_info: "info", license_compare: "compare",
          license_list: "list", license_compatible: "compatible",
        };
        const result = await tool.execute({
          action: action_map[n.action || ""] || "list",
          id: n.license_id || undefined,
          id2: n.license_id2 || undefined,
          author: resolve_templates(n.license_author || "", tpl) || undefined,
          year: n.license_year || undefined,
          text: resolve_templates(n.license_text || "", tpl) || undefined,
        });
        try {
          return { output: { result: JSON.parse(result) } };
        } catch {
          return { output: { result: result } };
        }
      } catch {
        return { output: { result: null } };
      }
    }

    try {
      const { ChangelogTool } = await import("../tools/changelog.js");
      const tool = new ChangelogTool();
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
    const LICENSE_OPS = ["license_generate", "license_detect", "license_info", "license_compare", "license_list", "license_compatible"];
    if (!LICENSE_OPS.includes(n.action || "") && n.action !== "validate_commit" && !n.commits) warnings.push("commits data is required");
    return { preview: { action: n.action, version: n.version }, warnings };
  },
};
