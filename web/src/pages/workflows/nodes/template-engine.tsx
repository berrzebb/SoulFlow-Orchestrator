import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function TemplateEngineEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.template")}>
        <textarea autoFocus className="input code-textarea" rows={6} value={String(node.template || "")} onChange={(e) => update({ template: e.target.value })} placeholder="Hello {{name}}! {{#if premium}}Premium user{{/if}}" />
      </BuilderField>
      <BuilderField label={`${t("workflows.input_data")} (JSON)`}>
        <textarea className="input code-textarea" rows={3} value={String(node.data || "{}")} onChange={(e) => update({ data: e.target.value })} placeholder='{"name": "Alice", "premium": true}' />
      </BuilderField>
      <BuilderField label={t("workflows.field_partials_json")}>
        <textarea className="input code-textarea" rows={2} value={String(node.partials || "{}")} onChange={(e) => update({ partials: e.target.value })} placeholder='{"header": "<h1>{{title}}</h1>"}' />
      </BuilderField>
    </>
  );
}

export const template_engine_descriptor: FrontendNodeDescriptor = {
  node_type: "template_engine",
  icon: "\u{1F4C4}",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.template_engine.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.template_engine.output.result" },
    { name: "success", type: "boolean", description: "node.template_engine.output.success" },
  ],
  input_schema: [
    { name: "template", type: "string", description: "node.template_engine.input.template" },
    { name: "data",     type: "string", description: "node.template_engine.input.data" },
  ],
  create_default: () => ({ template: "", data: "{}", partials: "{}" }),
  EditPanel: TemplateEngineEditPanel,
};
