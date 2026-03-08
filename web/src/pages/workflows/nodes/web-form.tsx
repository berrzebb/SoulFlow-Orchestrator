import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

function WebFormEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.scrape_url")}>
        <input autoFocus className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/form" />
      </BuilderField>
      <JsonField label={t("workflows.form_fields")} value={node.fields ?? {}} onUpdate={(v) => update({ fields: v })} rows={4} placeholder='{"#email": "test@test.com", "#password": "***"}' emptyValue={{}} />
      <BuilderRowPair>
        <BuilderField label={t("workflows.submit_selector")}>
          <input className="input input--sm" value={String(node.submit_selector || "")} onChange={(e) => update({ submit_selector: e.target.value })} placeholder='button[type="submit"]' />
        </BuilderField>
        <BuilderField label={t("workflows.wait_after_ms")}>
          <input className="input input--sm" type="number" min={0} max={30000} step={500} value={String(node.wait_after_ms ?? 2000)} onChange={(e) => update({ wait_after_ms: Number(e.target.value) || 2000 })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const web_form_descriptor: FrontendNodeDescriptor = {
  node_type: "web_form",
  icon: "\u{1F4DD}",
  color: "#7b1fa2",
  shape: "rect",
  toolbar_label: "node.web_form.label",
  category: "integration",
  output_schema: [
    { name: "fields_filled", type: "array",   description: "node.web_form.output.fields_filled" },
    { name: "submitted",     type: "boolean",  description: "node.web_form.output.submitted" },
    { name: "snapshot",      type: "string",   description: "node.web_form.output.snapshot" },
  ],
  input_schema: [
    { name: "url",    type: "string", description: "node.web_form.input.url" },
    { name: "fields", type: "object", description: "node.web_form.input.fields" },
  ],
  create_default: () => ({ url: "", fields: {}, submit_selector: "", wait_after_ms: 2000 }),
  EditPanel: WebFormEditPanel,
};
