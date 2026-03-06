import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function AnalyzerEditPanel({ node, update, t, options }: EditPanelProps) {
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
        <label className="label">{t("workflows.analyzer_input") || "Input Field"}</label>
        <input className="input input--sm" value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.resume_text" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.analyzer_prompt") || "Analysis Prompt"}</label>
        <textarea className="input code-textarea" rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder="Analyze the following resume and extract key skills, experience level, and fit score..." />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.analyzer_categories") || "Categories"}</label>
        <input className="input input--sm" value={Array.isArray(node.categories) ? (node.categories as string[]).join(", ") : ""} onChange={(e) => update({ categories: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="qualified, unqualified, maybe" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_schema") || "Output Schema"}</label>
        <textarea
          className={`input code-textarea${schemaErr ? " input--err" : ""}`}
          rows={3}
          value={schemaRaw}
          onChange={(e) => handleSchema(e.target.value)}
          spellCheck={false}
          placeholder='{"type": "object", "properties": {"score": {"type": "number"}, "category": {"type": "string"}}}'
        />
        {schemaErr && <span className="field-error">{schemaErr}</span>}
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
    </>
  );
}

export const analyzer_descriptor: FrontendNodeDescriptor = {
  node_type: "analyzer",
  icon: "🔍",
  color: "#e91e63",
  shape: "rect",
  toolbar_label: "+ Analyzer",
  category: "ai",
  output_schema: [
    { name: "analysis",   type: "object",  description: "Structured analysis result" },
    { name: "category",   type: "string",  description: "Classification category" },
    { name: "confidence", type: "number",  description: "Confidence score (0-1)" },
    { name: "raw_output", type: "string",  description: "Raw LLM output" },
  ],
  input_schema: [
    { name: "input",  type: "unknown", description: "Data to analyze" },
    { name: "prompt", type: "string",  description: "Analysis instructions" },
    { name: "schema", type: "object",  description: "Expected output structure" },
  ],
  create_default: () => ({
    backend: "",
    prompt_template: "Analyze the following:\n\n{{input}}",
    input_field: "input",
    categories: [],
  }),
  EditPanel: AnalyzerEditPanel,
};
