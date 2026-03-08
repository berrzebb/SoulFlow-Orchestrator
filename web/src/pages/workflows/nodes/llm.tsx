import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { useProviderModels } from "../use-provider-models";

function LlmEditPanel({ node, update, t, options }: EditPanelProps) {
  const { models, loading: modelsLoading } = useProviderModels(node.backend as string | undefined, options);
  const [schemaRaw, setSchemaRaw] = useState(node.output_json_schema ? JSON.stringify(node.output_json_schema, null, 2) : "");
  const [schemaErr, setSchemaErr] = useState("");
  const temp = node.temperature as number | undefined;

  const handleSchema = (val: string) => {
    setSchemaRaw(val);
    if (!val.trim()) { setSchemaErr(""); update({ output_json_schema: undefined }); return; }
    try { update({ output_json_schema: JSON.parse(val) }); setSchemaErr(""); }
    catch { setSchemaErr(t("workflows.invalid_json")); }
  };

  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.llm_backend")}<span className="label__required">*</span></label>
          <select autoFocus className="input input--sm" required value={String(node.backend || "")} onChange={(e) => update({ backend: e.target.value })} aria-required="true">
            <option value="">-</option>
            {(options?.backends || []).map((b) => (
              <option key={b.value} value={b.value}>
                {b.available === false ? "\u26AA " : "\uD83D\uDFE2 "}{b.label}{b.provider_type ? ` (${b.provider_type})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.llm_model")}<span className="label__required">*</span></label>
          {modelsLoading ? (
            <input className="input input--sm" disabled aria-busy="true" placeholder="loading..." />
          ) : models.length > 0 ? (
            <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
              <option value="">auto</option>
              {models.filter((m) => m.purpose !== "embedding").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="auto" />
          )}
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_prompt")}<span className="label__required">*</span></label>
        <textarea className="input code-textarea" required rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder="{{prompt}}" aria-required="true" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_system")}<span className="label__optional">(optional)</span></label>
        <textarea className="input" rows={3} value={String(node.system_prompt || "")} onChange={(e) => update({ system_prompt: e.target.value })} placeholder={t("common.optional")} />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">
            {t("workflows.llm_temperature")}
            <span className="builder-hint--inline">
              {temp == null ? "" : ` (${temp <= 0.3 ? t("workflows.temp_precise") : temp <= 0.7 ? t("workflows.temp_balanced") : t("workflows.temp_creative")})`}
            </span>
          </label>
          <input className="input input--sm" type="range" min={0} max={2} step={0.1} value={String(temp ?? 0.7)} onChange={(e) => update({ temperature: Number(e.target.value) })} />
          <span className="builder-hint">{temp ?? 0.7}</span>
        </div>
        <div className="builder-row">
          <label className="label">{t("providers.max_tokens")}</label>
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
  toolbar_label: "node.llm.label",
  category: "ai",
  output_schema: [
    { name: "response", type: "string",  description: "node.llm.output.response" },
    { name: "parsed",   type: "object",  description: "node.llm.output.parsed" },
    { name: "usage",    type: "object",  description: "node.llm.output.usage" },
  ],
  input_schema: [
    { name: "prompt",  type: "string", description: "node.llm.input.prompt" },
    { name: "context", type: "object", description: "node.llm.input.context" },
  ],
  create_default: () => ({ backend: "", prompt_template: "{{prompt}}" }),
  EditPanel: LlmEditPanel,
};
