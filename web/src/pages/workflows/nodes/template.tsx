import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TemplateEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.template_body")}</label>
        <textarea className="input code-textarea" rows={6} value={String(node.template || "")} onChange={(e) => update({ template: e.target.value })} spellCheck={false} placeholder="Hello {{input.name}}, your order #{{input.order_id}} is ready." />
        <span className="builder-hint">{t("workflows.template_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_output_field")}</label>
        <input className="input input--sm" value={String(node.output_field || "text")} onChange={(e) => update({ output_field: e.target.value })} />
      </div>
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
  create_default: () => ({ template: "{{input}}" }),
  EditPanel: TemplateEditPanel,
};
