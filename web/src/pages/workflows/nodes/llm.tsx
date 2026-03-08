import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BackendModelPicker, BuilderRowPair, TemperatureField } from "../builder-field";
import { useJsonField } from "../use-json-field";

function LlmEditPanel({ node, update, t, options }: EditPanelProps) {
  const { raw: schemaRaw, err: schemaErr, onChange: handleSchema } = useJsonField(node.output_json_schema, (v) => update({ output_json_schema: v }));
  const temp = node.temperature as number | undefined;

  return (
    <>
      <BackendModelPicker
        backend={String(node.backend || "")}
        onBackendChange={(v) => update({ backend: v })}
        model={node.model as string | undefined}
        onModelChange={(v) => update({ model: v })}
        options={options}
        required
        autoFocus
        backendLabel={t("workflows.llm_backend")}
        modelLabel={t("workflows.llm_model")}
      />
      <BuilderField label={t("workflows.llm_prompt")} required>
        <textarea className="input code-textarea" required rows={4} value={String(node.prompt_template || "")} onChange={(e) => update({ prompt_template: e.target.value })} spellCheck={false} placeholder="{{prompt}}" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.llm_system")} optional>
        <textarea className="input" rows={3} value={String(node.system_prompt || "")} onChange={(e) => update({ system_prompt: e.target.value })} placeholder={t("common.optional")} />
      </BuilderField>
      <BuilderRowPair>
        <TemperatureField value={temp} onChange={(v) => update({ temperature: v })} />
        <BuilderField label={t("providers.max_tokens")}>
          <input className="input input--sm" type="number" min={1} value={String(node.max_tokens ?? "")} onChange={(e) => update({ max_tokens: e.target.value ? Number(e.target.value) : undefined })} />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.llm_schema")} error={schemaErr}>
        <textarea
          className={`input code-textarea${schemaErr ? " input--err" : ""}`}
          rows={3}
          value={schemaRaw}
          onChange={(e) => handleSchema(e.target.value)}
          spellCheck={false}
          placeholder='{"type": "object", "properties": {...}}'
        />
      </BuilderField>
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
