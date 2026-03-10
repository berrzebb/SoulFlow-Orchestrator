import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BackendModelPicker, TemperatureField, JsonField } from "../builder-field";

const SENTIMENT_ACTIONS = ["analyze", "batch", "compare", "keywords", "score_text"];

function AnalyzerEditPanel({ node, update, t, options }: EditPanelProps) {
  const temp = node.temperature as number | undefined;
  const mode = String(node.mode || "llm");

  return (
    <>
      <BuilderField label={t("workflows.analyzer_mode")} required>
        <select autoFocus className="input input--sm" value={mode} onChange={(e) => update({ mode: e.target.value })}>
          <option value="llm">LLM</option>
          <option value="sentiment">Sentiment</option>
        </select>
      </BuilderField>

      {mode === "sentiment" ? (
        <>
          <BuilderField label={t("workflows.action")}>
            <select className="input input--sm" value={String(node.sentiment_action || "analyze")} onChange={(e) => update({ sentiment_action: e.target.value })}>
              {SENTIMENT_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.analyzer_input")} required>
            <textarea className="input code-textarea" required rows={3} value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.text_to_analyze" aria-required="true" />
          </BuilderField>
        </>
      ) : (
        <>
          <BackendModelPicker
            backend={String(node.backend || "")}
            onBackendChange={(v) => update({ backend: v })}
            model={node.model as string | undefined}
            onModelChange={(v) => update({ model: v })}
            options={options}
            required
            backendLabel={t("workflows.llm_backend")}
            modelLabel={t("workflows.llm_model")}
          />
          <BuilderField label={t("workflows.analyzer_input")} required>
            <input className="input input--sm" required value={String(node.input_field || "")} onChange={(e) => update({ input_field: e.target.value })} placeholder="memory.resume_text" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.analyzer_prompt")} required>
            <textarea className="input code-textarea" required rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder={t("node.analyzer.prompt_template_placeholder")} aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.analyzer_categories")} optional>
            <input className="input input--sm" value={Array.isArray(node.categories) ? (node.categories as string[]).join(", ") : ""} onChange={(e) => update({ categories: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="qualified, unqualified, maybe" />
          </BuilderField>
          <JsonField label={t("workflows.llm_schema")} value={node.output_json_schema} onUpdate={(v) => update({ output_json_schema: v })} rows={3} placeholder='{"type": "object", "properties": {"score": {"type": "number"}, "category": {"type": "string"}}}' />
          <TemperatureField value={temp} onChange={(v) => update({ temperature: v })} />
        </>
      )}
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
    mode: "llm",
    backend: "",
    prompt_template: "Analyze the following:\n\n{{input}}",
    input_field: "input",
    categories: [],
    sentiment_action: "analyze",
  }),
  EditPanel: AnalyzerEditPanel,
};
