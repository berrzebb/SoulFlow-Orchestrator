/** AI Agent (도구 사용 에이전트) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { AiAgentNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const ai_agent_handler: NodeHandler = {
  node_type: "ai_agent",
  icon: "🤖",
  color: "#673ab7",
  shape: "rect",
  output_schema: [
    { name: "result",      type: "string",  description: "Agent final output" },
    { name: "tool_calls",  type: "array",   description: "Tool call history" },
    { name: "turns_used",  type: "number",  description: "Number of turns used" },
    { name: "structured",  type: "object",  description: "Structured output (if schema provided)" },
  ],
  input_schema: [
    { name: "user_prompt",   type: "string", description: "User input prompt" },
    { name: "system_prompt", type: "string", description: "System instructions" },
    { name: "tools",         type: "array",  description: "Available tool node IDs" },
  ],
  create_default: () => ({
    backend: "openrouter",
    system_prompt: "You are a helpful assistant.",
    user_prompt: "{{input}}",
    tool_nodes: [],
    max_turns: 10,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as AiAgentNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const system_prompt = resolve_templates(n.system_prompt, tpl_ctx);
    const user_prompt = resolve_templates(n.user_prompt, tpl_ctx);

    // 실제 에이전트 루프는 phase-loop-runner가 backend resolver + tool dispatcher를 통해 실행.
    // 여기서는 구조만 반환.
    return {
      output: {
        result: "",
        tool_calls: [],
        turns_used: 0,
        structured: null,
        _meta: {
          backend: n.backend,
          model: n.model,
          system_prompt,
          user_prompt,
          tool_nodes: n.tool_nodes || [],
          max_turns: n.max_turns ?? 10,
          output_json_schema: n.output_json_schema,
          resolved: true,
        },
      },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as AiAgentNodeDefinition;
    const warnings: string[] = [];
    if (!n.backend) warnings.push("backend is not set");
    if (!n.user_prompt) warnings.push("user_prompt is empty");
    if (!n.system_prompt) warnings.push("system_prompt is empty");
    if ((n.max_turns ?? 10) > 50) warnings.push("max_turns > 50 may be expensive");
    if (n.tool_nodes && n.tool_nodes.length === 0) warnings.push("no tool_nodes — agent cannot use tools");
    return {
      preview: {
        backend: n.backend,
        model: n.model || "auto",
        tool_count: n.tool_nodes?.length || 0,
        max_turns: n.max_turns ?? 10,
        has_schema: !!n.output_json_schema,
      },
      warnings,
    };
  },
};
