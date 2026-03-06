import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebFormEditPanel({ node, update, t }: EditPanelProps) {
  const [fieldsRaw, setFieldsRaw] = useState(node.fields ? JSON.stringify(node.fields, null, 2) : "{}");
  const [fieldsErr, setFieldsErr] = useState("");

  const handleFields = (val: string) => {
    setFieldsRaw(val);
    if (!val.trim()) { setFieldsErr(""); update({ fields: {} }); return; }
    try { update({ fields: JSON.parse(val) }); setFieldsErr(""); }
    catch { setFieldsErr("Invalid JSON"); }
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.scrape_url")}</label>
        <input className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/form" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.form_fields")}</label>
        <textarea
          className={`input code-textarea${fieldsErr ? " input--err" : ""}`}
          rows={4}
          value={fieldsRaw}
          onChange={(e) => handleFields(e.target.value)}
          placeholder='{"#email": "test@test.com", "#password": "***"}'
        />
        {fieldsErr && <span className="field-error">{fieldsErr}</span>}
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.submit_selector")}</label>
          <input className="input input--sm" value={String(node.submit_selector || "")} onChange={(e) => update({ submit_selector: e.target.value })} placeholder='button[type="submit"]' />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.wait_after_ms")}</label>
          <input className="input input--sm" type="number" min={0} max={30000} step={500} value={String(node.wait_after_ms ?? 2000)} onChange={(e) => update({ wait_after_ms: Number(e.target.value) || 2000 })} />
        </div>
      </div>
    </>
  );
}

export const web_form_descriptor: FrontendNodeDescriptor = {
  node_type: "web_form",
  icon: "\u{1F4DD}",
  color: "#7b1fa2",
  shape: "rect",
  toolbar_label: "+ Web Form",
  category: "integration",
  output_schema: [
    { name: "fields_filled", type: "array",   description: "Fill results" },
    { name: "submitted",     type: "boolean",  description: "Whether submitted" },
    { name: "snapshot",      type: "string",   description: "Page snapshot" },
  ],
  input_schema: [
    { name: "url",    type: "string", description: "Form URL" },
    { name: "fields", type: "object", description: "Selector-to-value mapping" },
  ],
  create_default: () => ({ url: "", fields: {}, submit_selector: "", wait_after_ms: 2000 }),
  EditPanel: WebFormEditPanel,
};
