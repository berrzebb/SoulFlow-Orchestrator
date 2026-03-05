/** LLM (단일 프롬프트→응답) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { LlmNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

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

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 LLM 호출은 추후 구현
    return { output: { response: "", parsed: null, usage: {} } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LlmNodeDefinition;
    const warnings: string[] = [];
    if (!n.prompt_template?.trim()) warnings.push("prompt_template is empty");
    return { preview: { backend: n.backend, model: n.model, prompt_template: n.prompt_template }, warnings };
  },
};
