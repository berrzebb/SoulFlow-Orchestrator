import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function AnalyzerEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.llm_backend") || "Backend"}</label>
          <select className="input input--sm" value={String(node.backend || "openrouter")} onChange={(e) => update({ backend: e.target.value })}>
            <option value="openrouter">OpenRouter</option>
            <option value="claude_sdk">Claude SDK</option>
            <option value="claude_cli">Claude CLI</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.llm_model") || "Model"}</label>
          <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="auto" />
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
        <textarea className="input code-textarea" rows={3} value={node.output_json_schema ? JSON.stringify(node.output_json_schema, null, 2) : ""} onChange={(e) => { try { update({ output_json_schema: e.target.value ? JSON.parse(e.target.value) : undefined }); } catch { /* ignore */ } }} spellCheck={false} placeholder='{"type": "object", "properties": {"score": {"type": "number"}, "category": {"type": "string"}}}' />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.llm_temperature") || "Temperature"}</label>
        <input className="input input--sm" type="number" min={0} max={2} step={0.1} value={String(node.temperature ?? "")} onChange={(e) => update({ temperature: e.target.value ? Number(e.target.value) : undefined })} />
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
    backend: "openrouter",
    prompt_template: "Analyze the following:\n\n{{input}}",
    input_field: "input",
    categories: [],
  }),
  EditPanel: AnalyzerEditPanel,
};
