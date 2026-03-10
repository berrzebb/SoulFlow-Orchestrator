/** Regex 노드 핸들러 — 워크플로우에서 정규식 매칭/치환/추출. */

import type { NodeHandler } from "../node-registry.js";
import type { RegexNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const regex_handler: NodeHandler = {
  node_type: "regex",
  icon: "\u{1F50D}",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Regex operation result (JSON)" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "match/match_all/replace/extract/split/test" },
    { name: "input",     type: "string", description: "Input text" },
    { name: "pattern",   type: "string", description: "Regex pattern" },
  ],
  create_default: () => ({ operation: "match", input: "", pattern: "", flags: "g", replacement: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RegexNodeDefinition;
    const tpl = { memory: ctx.memory };
    const input = resolve_templates(n.input || "", tpl);
    const pattern = resolve_templates(n.pattern || "", tpl);
    const flags = n.flags || "";
    const op = n.operation || "match";

    if (op === "glob_test" || op === "glob_filter") {
      const { GlobMatchTool } = await import("../tools/glob-match.js");
      const tool = new GlobMatchTool();
      const action = op === "glob_test" ? "test" : "filter";
      const raw = await tool.execute({ action, pattern, input, inputs: input });
      return { output: { result: raw, success: !raw.startsWith("{\"error\"") } };
    }

    if (!pattern) return { output: { result: "Error: pattern is required", success: false } };

    try {
      const re = new RegExp(pattern, flags);

      switch (op) {
        case "test":
          return { output: { result: JSON.stringify({ matches: re.test(input) }), success: true } };

        case "match": {
          const m = input.match(re);
          if (!m) return { output: { result: JSON.stringify({ found: false }), success: true } };
          return { output: { result: JSON.stringify({ found: true, match: m[0], index: m.index, groups: m.groups || null }), success: true } };
        }

        case "match_all": {
          const global_re = flags.includes("g") ? re : new RegExp(re.source, flags + "g");
          const matches: { match: string; index: number }[] = [];
          let m: RegExpExecArray | null;
          while ((m = global_re.exec(input)) !== null && matches.length < 100) {
            matches.push({ match: m[0], index: m.index });
            if (!global_re.global) break;
          }
          return { output: { result: JSON.stringify({ count: matches.length, matches }), success: true } };
        }

        case "replace":
          return { output: { result: input.replace(re, n.replacement || ""), success: true } };

        case "extract": {
          const global_re = flags.includes("g") ? re : new RegExp(re.source, flags + "g");
          const results: Record<string, string>[] = [];
          let m: RegExpExecArray | null;
          while ((m = global_re.exec(input)) !== null && results.length < 100) {
            if (m.groups) results.push({ ...m.groups });
            else if (m.length > 1) {
              const obj: Record<string, string> = {};
              m.slice(1).forEach((v, i) => { obj[`group_${i + 1}`] = v ?? ""; });
              results.push(obj);
            }
            if (!global_re.global) break;
          }
          return { output: { result: JSON.stringify({ count: results.length, extracted: results }), success: true } };
        }

        case "split":
          return { output: { result: JSON.stringify(input.split(re).slice(0, 100)), success: true } };

        default:
          return { output: { result: `Unsupported: ${op}`, success: false } };
      }
    } catch (err) {
      return { output: { result: (err as Error).message, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RegexNodeDefinition;
    const warnings: string[] = [];
    if (!n.pattern?.trim()) warnings.push("pattern is required");
    try { if (n.pattern) new RegExp(n.pattern); } catch { warnings.push("invalid regex pattern"); }
    return { preview: { operation: n.operation, pattern: n.pattern, flags: n.flags }, warnings };
  },
};
