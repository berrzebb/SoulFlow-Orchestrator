/** LLM (단일 프롬프트→응답) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { LlmNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const llm_handler: NodeHandler = {
  node_type: "llm",
  icon: "🤖",
  color: "#e91e63",
  shape: "rect",
  output_schema: [
    { name: "response", type: "string",  description: "LLM response text" },
    { name: "parsed",   type: "object",  description: "Parsed JSON (if output_json_schema)" },
    { name: "usage",    type: "object",  description: "Token usage stats" },
  ],
  input_schema: [
    { name: "prompt",  type: "string", description: "Input prompt / context" },
    { name: "context", type: "object", description: "Template variables" },
  ],
  create_default: () => ({ backend: "openrouter", prompt_template: "{{prompt}}" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as LlmNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const prompt = resolve_templates(n.prompt_template || "", tpl_ctx);
    const system_prompt = n.system_prompt ? resolve_templates(n.system_prompt, tpl_ctx) : undefined;

    return {
      output: {
        response: "",
        parsed: null,
        usage: {},
        _meta: {
          backend: n.backend,
          model: n.model,
          prompt,
          system_prompt,
          temperature: n.temperature,
          max_tokens: n.max_tokens,
          output_json_schema: n.output_json_schema,
          resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const invoke = runner.services?.invoke_llm;
    if (!invoke) return this.execute(node, ctx);

    const n = node as LlmNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const prompt = resolve_templates(n.prompt_template || "", tpl_ctx);
    const system = n.system_prompt ? resolve_templates(n.system_prompt, tpl_ctx) : undefined;

    try {
      const result = await invoke({
        provider_id: n.backend,
        prompt,
        system,
        model: n.model,
        temperature: n.temperature,
        max_tokens: n.max_tokens,
        output_json_schema: n.output_json_schema as Record<string, unknown> | undefined,
        abort_signal: ctx.abort_signal,
      });
      return { output: { response: result.content, parsed: result.parsed ?? null, usage: result.usage ?? {} } };
    } catch (err) {
      runner.logger.warn("llm_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { response: "", parsed: null, usage: {}, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LlmNodeDefinition;
    const warnings: string[] = [];
    if (!n.prompt_template?.trim()) warnings.push("prompt_template is empty");
    return { preview: { backend: n.backend, model: n.model, prompt_template: n.prompt_template }, warnings };
  },
};
