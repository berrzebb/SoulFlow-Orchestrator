import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BackendModelPicker, BuilderRowPair, TemperatureField, JsonField, NodeMultiSelect } from "../builder-field";

type AgentDefOption = NonNullable<NonNullable<EditPanelProps["options"]>["agent_definitions"]>[number];

/** soul + heart → 시스템 프롬프트로 합성 */
function compose_system_prompt(def: AgentDefOption): string {
  return [def.soul, def.heart].filter(Boolean).join("\n\n");
}

function AiAgentEditPanel({ node, update, t, options }: EditPanelProps) {
  const temp = node.temperature as number | undefined;
  const definitions = options?.agent_definitions || [];

  function apply_definition(id: string) {
    const def = definitions.find((d) => d.id === id);
    if (!def) { update({ definition_id: "" }); return; }
    const system_prompt = compose_system_prompt(def);
    update({
      definition_id: id,
      ...(system_prompt ? { system_prompt } : {}),
      ...(def.model ? { model: def.model } : {}),
      ...(def.preferred_providers[0] ? { backend: def.preferred_providers[0] } : {}),
    });
  }

  return (
    <>
      {definitions.length > 0 && (
        <BuilderField label={t("workflows.agent_definition")} hint={t("workflows.agent_definition_hint")}>
          <select className="input input--sm" value={String(node.definition_id || "")} onChange={(e) => apply_definition(e.target.value)}>
            <option value="">— {t("workflows.agent_definition_none")} —</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>{d.icon} {d.name}</option>
            ))}
          </select>
        </BuilderField>
      )}
      <BackendModelPicker
        backend={String(node.backend || "")}
        onBackendChange={(v) => update({ backend: v })}
        model={node.model as string | undefined}
        onModelChange={(v) => update({ model: v })}
        options={options}
        autoFocus
        backendLabel={t("workflows.llm_backend")}
        modelLabel={t("workflows.llm_model")}
      />
      <BuilderField label={t("workflows.ai_agent_system")}>
        <textarea className="input code-textarea" rows={3} value={String(node.system_prompt || "")} onChange={(e) => update({ system_prompt: e.target.value })} spellCheck={false} placeholder={t("node.ai_agent.system_prompt_placeholder")} />
      </BuilderField>
      <BuilderField label={t("workflows.ai_agent_user")}>
        <textarea className="input code-textarea" rows={3} value={String(node.user_prompt || "")} onChange={(e) => update({ user_prompt: e.target.value })} spellCheck={false} placeholder="{{memory.user_input}}" />
      </BuilderField>
      <BuilderField label={t("workflows.ai_agent_tools")} hint={t("workflows.tool_nodes_hint")}>
        <NodeMultiSelect value={Array.isArray(node.tool_nodes) ? node.tool_nodes as string[] : []} onChange={(ids) => update({ tool_nodes: ids })} nodes={options?.workflow_nodes} placeholder="http-1, code-1, db-1" />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.max_turns")} hint={t("workflows.max_turns_hint")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.max_turns ?? 10)} onChange={(e) => update({ max_turns: Number(e.target.value) || 10 })} />
        </BuilderField>
        <TemperatureField value={temp} onChange={(v) => update({ temperature: v })} />
      </BuilderRowPair>
      <JsonField label={t("workflows.llm_schema")} value={node.output_json_schema} onUpdate={(v) => update({ output_json_schema: v })} rows={3} placeholder='{"type": "object", "properties": {...}}' />
    </>
  );
}

export const ai_agent_descriptor: FrontendNodeDescriptor = {
  node_type: "ai_agent",
  icon: "🤖",
  color: "#673ab7",
  shape: "rect",
  toolbar_label: "node.ai_agent.label",
  category: "ai",
  output_schema: [
    { name: "result",      type: "string",  description: "node.ai_agent.output.result" },
    { name: "tool_calls",  type: "array",   description: "node.ai_agent.output.tool_calls" },
    { name: "turns_used",  type: "number",  description: "node.ai_agent.output.turns_used" },
    { name: "structured",  type: "object",  description: "node.ai_agent.output.structured" },
  ],
  input_schema: [
    { name: "user_prompt",   type: "string", description: "node.ai_agent.input.user_prompt" },
    { name: "system_prompt", type: "string", description: "node.ai_agent.input.system_prompt" },
    { name: "tools",         type: "array",  description: "node.ai_agent.input.tools" },
  ],
  create_default: () => ({
    backend: "",
    system_prompt: "You are a helpful assistant.",
    user_prompt: "{{input}}",
    tool_nodes: [],
    max_turns: 10,
  }),
  EditPanel: AiAgentEditPanel,
};
