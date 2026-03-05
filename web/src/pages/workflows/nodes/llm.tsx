import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LlmEditPanel({ node, update, t, options }: EditPanelProps) {
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
          <label className="label">{t("workflows.llm_backend")}</label>
          <select className="input input--sm" value={String(node.backend || "openrouter")} onChange={(e) => update({ backend: e.target.value })}>
            <option value="openrouter">OpenRouter</option>
            <option value="claude_sdk">Claude SDK</option>
            <option value="claude_cli">Claude CLI</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.llm_model")}</label>
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
        <label className="label">{t("workflows.llm_prompt")}</label>
        <textarea className="input code-textarea" rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder="{{prompt}}" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_system")}</label>
        <textarea className="input" rows={3} value={String(node.system_prompt || "")} onChange={(e) => update({ system_prompt: e.target.value })} placeholder={t("common.optional")} />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">
            {t("workflows.llm_temperature")}
            <span className="builder-hint--inline">
              {temp == null ? "" : temp <= 0.3 ? " (precise)" : temp <= 0.7 ? " (balanced)" : " (creative)"}
            </span>
          </label>
          <input className="input input--sm" type="range" min={0} max={2} step={0.1} value={String(temp ?? 0.7)} onChange={(e) => update({ temperature: Number(e.target.value) })} />
          <span className="builder-hint">{temp ?? 0.7}</span>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.max_turns")}</label>
          <input className="input input--sm" type="number" min={1} value={String(node.max_tokens ?? "")} onChange={(e) => update({ max_tokens: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_schema")}</label>
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

export const llm_descriptor: FrontendNodeDescriptor = {
  node_type: "llm",
  icon: "🤖",
  color: "#e91e63",
  shape: "rect",
  toolbar_label: "+ LLM",
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
  EditPanel: LlmEditPanel,
};
