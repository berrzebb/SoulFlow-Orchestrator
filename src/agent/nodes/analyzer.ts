/** Analyzer (AI 분석기) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { AnalyzerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

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

    return {
      output: {
        analysis: {},
        category: n.categories?.[0] || "unknown",
        confidence: 0,
        raw_output: "",
        _meta: {
          backend: n.backend, model: n.model, prompt, input_field,
          output_json_schema: n.output_json_schema, categories: n.categories,
          resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const invoke = runner.services?.invoke_llm;
    if (!invoke) return this.execute(node, ctx);

    const n = node as AnalyzerNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const prompt = resolve_templates(n.prompt_template, tpl_ctx);
    const cats = n.categories?.length ? `\nCategories: ${n.categories.join(", ")}` : "";
    const schema = n.output_json_schema as Record<string, unknown> | undefined ?? {
      type: "object",
      properties: {
        category: { type: "string" },
        confidence: { type: "number" },
        analysis: { type: "object" },
      },
    };

    try {
      const result = await invoke({
        provider_id: n.backend,
        prompt: prompt + cats,
        system: "You are an analysis engine. Respond with structured JSON only.",
        model: n.model,
        temperature: 0,
        output_json_schema: schema,
        abort_signal: ctx.abort_signal,
      });
      const parsed = result.parsed as Record<string, unknown> | null;
      return {
        output: {
          analysis: parsed ?? {},
          category: String(parsed?.category ?? n.categories?.[0] ?? "unknown"),
          confidence: Number(parsed?.confidence ?? 0),
          raw_output: result.content,
        },
      };
    } catch (err) {
      runner.logger.warn("analyzer_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { analysis: {}, category: "error", confidence: 0, raw_output: "", error: error_message(err) } };
    }
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
