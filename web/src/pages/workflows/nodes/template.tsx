import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TemplateEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.template_body")} hint={t("workflows.template_hint")}>
        <textarea autoFocus className="input code-textarea" rows={6} value={String(node.template || "")} onChange={(e) => update({ template: e.target.value })} spellCheck={false} placeholder="Hello {{input.name}}, your order #{{input.order_id}} is ready." aria-label={t("workflows.template_body")} />
      </BuilderField>
      <BuilderField label={t("workflows.field_output_field")}>
        <input className="input input--sm" value={String(node.output_field || "text")} onChange={(e) => update({ output_field: e.target.value })} placeholder="text" aria-label={t("workflows.field_output_field")} />
      </BuilderField>
    </>
  );
}

export const template_descriptor: FrontendNodeDescriptor = {
  node_type: "template",
  icon: "{ }",
  color: "#00bcd4",
  shape: "rect",
  toolbar_label: "node.template.label",
  category: "data",
  output_schema: [
    { name: "text", type: "string", description: "node.template.output.text" },
  ],
  input_schema: [
    { name: "input", type: "object", description: "node.template.input.input" },
  ],
  create_default: () => ({ template: "{{input}}", output_field: "text" }),
  EditPanel: TemplateEditPanel,
};
