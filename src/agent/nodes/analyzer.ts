/** Analyzer (AI 분석기) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { AnalyzerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const analyzer_handler: NodeHandler = {
  node_type: "analyzer",
  icon: "🔍",
  color: "#e91e63",
  shape: "rect",
  output_schema: [
    { name: "analysis",   type: "object",  description: "Structured analysis result" },
    { name: "category",   type: "string",  description: "Classification category" },
    { name: "confidence", type: "number",  description: "Confidence score (0-1)" },
    { name: "raw_output", type: "string",  description: "Raw LLM output" },
  ],
  input_schema: [
    { name: "input",    type: "unknown", description: "Data to analyze" },
    { name: "prompt",   type: "string",  description: "Analysis instructions" },
    { name: "schema",   type: "object",  description: "Expected output structure" },
  ],
  create_default: () => ({
    backend: "openrouter",
    prompt_template: "Analyze the following:\n\n{{input}}",
    input_field: "input",
    categories: [],
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as AnalyzerNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const prompt = resolve_templates(n.prompt_template, tpl_ctx);
    const input_field = resolve_templates(n.input_field, tpl_ctx);

    // 스텁: 실제 LLM 호출은 phase-loop-runner가 backend resolver를 통해 실행.
    // 여기서는 구조만 반환.
    return {
      output: {
        analysis: {},
        category: n.categories?.[0] || "unknown",
        confidence: 0,
        raw_output: "",
        _meta: {
          backend: n.backend,
          model: n.model,
          prompt,
          input_field,
          output_json_schema: n.output_json_schema,
          categories: n.categories,
          resolved: true,
        },
      },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as AnalyzerNodeDefinition;
    const warnings: string[] = [];
    if (!n.prompt_template) warnings.push("prompt_template is empty");
    if (!n.input_field) warnings.push("input_field is empty");
    if (!n.backend) warnings.push("backend is not set");
    if (n.output_json_schema) {
      try { JSON.stringify(n.output_json_schema); }
      catch { warnings.push("output_json_schema is invalid JSON"); }
    }
    return {
      preview: {
        backend: n.backend,
        model: n.model || "auto",
        input_field: n.input_field,
        categories: n.categories || [],
        has_schema: !!n.output_json_schema,
      },
      warnings,
    };
  },
};
