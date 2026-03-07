/** Tokenizer 노드 핸들러 — 워크플로우에서 텍스트 토큰화/키워드 추출. */

import type { NodeHandler } from "../node-registry.js";
import type { TokenizerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const tokenizer_handler: NodeHandler = {
  node_type: "tokenizer",
  icon: "\u{1F4AC}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Tokenization result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "word_tokenize / sentence_split / ngrams / tf_idf / keyword_extract / stopword_filter / token_estimate" },
    { name: "text", type: "string", description: "Input text" },
  ],
  create_default: () => ({ action: "word_tokenize", text: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TokenizerNodeDefinition;
    try {
      const { TokenizerTool } = await import("../tools/tokenizer.js");
      const tool = new TokenizerTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "word_tokenize",
        text: n.text ? resolve_templates(n.text, tpl) : "",
        n: n.n,
        top_k: n.top_k,
      });
      return { output: { result: JSON.parse(result) } };
    } catch {
      return { output: { result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TokenizerNodeDefinition;
    const warnings: string[] = [];
    if (!n.text) warnings.push("text is required");
    return { preview: { action: n.action }, warnings };
  },
};
