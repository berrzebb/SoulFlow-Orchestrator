/** Similarity 노드 핸들러 — 워크플로우에서 텍스트/벡터 유사도 측정. */

import type { NodeHandler } from "../node-registry.js";
import type { SimilarityNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const similarity_handler: NodeHandler = {
  node_type: "similarity",
  icon: "\u{1F50D}",
  color: "#4a148c",
  shape: "rect",
  output_schema: [
    { name: "score", type: "number", description: "Similarity score" },
    { name: "result", type: "unknown", description: "Full result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "cosine / jaccard / levenshtein / hamming / dice / jaro_winkler / euclidean" },
    { name: "a", type: "string", description: "First input" },
    { name: "b", type: "string", description: "Second input" },
  ],
  create_default: () => ({ action: "cosine", a: "", b: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SimilarityNodeDefinition;
    try {
      const { SimilarityTool } = await import("../tools/similarity.js");
      const tool = new SimilarityTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "cosine",
        a: n.a ? resolve_templates(n.a, tpl) : "",
        b: n.b ? resolve_templates(n.b, tpl) : "",
        mode: n.mode,
      });
      const parsed = JSON.parse(result);
      return { output: { score: parsed.similarity ?? parsed.distance ?? 0, result: parsed } };
    } catch {
      return { output: { score: 0, result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SimilarityNodeDefinition;
    const warnings: string[] = [];
    if (!n.a) warnings.push("a is required");
    if (!n.b) warnings.push("b is required");
    return { preview: { action: n.action }, warnings };
  },
};
