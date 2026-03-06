import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function AiAgentEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  const [schemaRaw, setSchemaRaw] = useState(node.output_json_schema ? JSON.stringify(node.output_json_schema, null, 2) : "");
  const [schemaErr, setSchemaErr] = useState("");
  const temp = node.temperature as number | undefined;

  const handleSchema = (val: string) => {
    setSchemaRaw(val);
    if (!val.trim()) { setSchemaErr(""); update({ output_json_schema: undefined }); return; }
    try { update({ output_json_schema: JSON.parse(val) }); setSchemaErr(""); }
    catch { setSchemaErr("Invalid JSON"); }
  };
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.llm_backend") || "Backend"}</label>
          <select className="input input--sm" value={String(node.backend || "")} onChange={(e) => update({ backend: e.target.value })}>
            {(options?.backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.llm_model") || "Model"}</label>
          {models.length > 0 ? (
            <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
              <option value="">auto</option>
              {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="auto" />
          )}
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.ai_agent_system") || "System Prompt"}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.system_prompt || "")} onChange={(e) => update({ system_prompt: e.target.value })} spellCheck={false} placeholder="You are a helpful assistant that can use tools to accomplish tasks." />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.ai_agent_user") || "User Prompt"}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.user_prompt || "")} onChange={(e) => update({ user_prompt: e.target.value })} spellCheck={false} placeholder="{{memory.user_input}}" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.ai_agent_tools") || "Tool Nodes"}</label>
        <input className="input input--sm" value={Array.isArray(node.tool_nodes) ? (node.tool_nodes as string[]).join(", ") : ""} onChange={(e) => update({ tool_nodes: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="http-1, code-1, db-1" />
        <span className="builder-hint">{t("workflows.tool_nodes_hint") || "Comma-separated node IDs the agent can call as tools"}</span>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.max_turns") || "Max Turns"}</label>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.max_turns ?? 10)} onChange={(e) => update({ max_turns: Number(e.target.value) || 10 })} />
        </div>
        <div className="builder-row">
          <label className="label">
            {t("workflows.llm_temperature") || "Temperature"}
            <span className="builder-hint--inline">
              {temp == null ? "" : temp <= 0.3 ? " (precise)" : temp <= 0.7 ? " (balanced)" : " (creative)"}
            </span>
          </label>
          <input className="input input--sm" type="range" min={0} max={2} step={0.1} value={String(temp ?? 0.7)} onChange={(e) => update({ temperature: Number(e.target.value) })} />
          <span className="builder-hint">{temp ?? 0.7}</span>
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_schema") || "Output Schema"}</label>
        <textarea
          className={`input code-textarea${schemaErr ? " input--err" : ""}`}
          rows={3}
          value={schemaRaw}
          onChange={(e) => handleSchema(e.target.value)}
          spellCheck={false}
          placeholder='{"type": "object", "properties": {...}}'
        />
        {schemaErr && <span className="field-error">{schemaErr}</span>}
      </div>
    </>
  );
}

export const ai_agent_descriptor: FrontendNodeDescriptor = {
  node_type: "ai_agent",
  icon: "🤖",
  color: "#673ab7",
  shape: "rect",
  toolbar_label: "+ Agent",
  category: "ai",
  output_schema: [
    { name: "result",      type: "string",  description: "Agent final output" },
    { name: "tool_calls",  type: "array",   description: "Tool call history" },
    { name: "turns_used",  type: "number",  description: "Number of turns used" },
    { name: "structured",  type: "object",  description: "Structured output (if schema)" },
  ],
  input_schema: [
    { name: "user_prompt",   type: "string", description: "User input prompt" },
    { name: "system_prompt", type: "string", description: "System instructions" },
    { name: "tools",         type: "array",  description: "Available tool node IDs" },
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
