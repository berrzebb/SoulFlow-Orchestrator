import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { useProviderModels } from "../use-provider-models";
import { BuilderField, BuilderRowPair, TemperatureField } from "../builder-field";

function AnalyzerEditPanel({ node, update, t, options }: EditPanelProps) {
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
      <BuilderRowPair>
        <BuilderField label={t("workflows.llm_backend")} required>
          <select autoFocus className="input input--sm" required value={String(node.backend || "")} onChange={(e) => update({ backend: e.target.value })} aria-required="true">
            <option value="">-</option>
            {(options?.backends || []).map((b) => (
              <option key={b.value} value={b.value}>
                {b.available === false ? "\u26AA " : "\uD83D\uDFE2 "}{b.label}{b.provider_type ? ` (${b.provider_type})` : ""}
              </option>
            ))}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.llm_model")} required>
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
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.analyzer_input")} required>
        <input className="input input--sm" required value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.resume_text" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.analyzer_prompt")} required>
        <textarea className="input code-textarea" required rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder="Analyze the following resume and extract key skills, experience level, and fit score..." aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.analyzer_categories")} optional>
        <input className="input input--sm" value={Array.isArray(node.categories) ? (node.categories as string[]).join(", ") : ""} onChange={(e) => update({ categories: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="qualified, unqualified, maybe" />
      </BuilderField>
      <BuilderField label={t("workflows.llm_schema")} error={schemaErr}>
        <textarea
          className={`input code-textarea${schemaErr ? " input--err" : ""}`}
          rows={3}
          value={schemaRaw}
          onChange={(e) => handleSchema(e.target.value)}
          spellCheck={false}
          placeholder='{"type": "object", "properties": {"score": {"type": "number"}, "category": {"type": "string"}}}'
        />
      </BuilderField>
      <TemperatureField value={temp} onChange={(v) => update({ temperature: v })} />
    </>
  );
}

export const analyzer_descriptor: FrontendNodeDescriptor = {
  node_type: "analyzer",
  icon: "🔍",
  color: "#e91e63",
  shape: "rect",
  toolbar_label: "node.analyzer.label",
  category: "ai",
  output_schema: [
    { name: "analysis",   type: "object",  description: "node.analyzer.output.analysis" },
    { name: "category",   type: "string",  description: "node.analyzer.output.category" },
    { name: "confidence", type: "number",  description: "node.analyzer.output.confidence" },
    { name: "raw_output", type: "string",  description: "node.analyzer.output.raw_output" },
  ],
  input_schema: [
    { name: "input",  type: "unknown", description: "node.analyzer.input.input" },
    { name: "prompt", type: "string",  description: "node.analyzer.input.prompt" },
    { name: "schema", type: "object",  description: "node.analyzer.input.schema" },
  ],
  create_default: () => ({
    backend: "",
    prompt_template: "Analyze the following:\n\n{{input}}",
    input_field: "input",
    categories: [],
  }),
  EditPanel: AnalyzerEditPanel,
};
