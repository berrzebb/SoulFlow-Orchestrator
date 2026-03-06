import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

interface FormFieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "boolean";
  required?: boolean;
  default_value?: string;
  options?: string[];
  placeholder?: string;
}

function FormEditPanel({ node, update, t, options }: EditPanelProps) {
  const target = String(node.target || "origin");
  const channels = options?.channels || [];
  const fields = (node.fields || []) as FormFieldDef[];
  const [expanded, setExpanded] = useState<number | null>(null);

  const updateField = (idx: number, patch: Partial<FormFieldDef>) => {
    const next = [...fields];
    next[idx] = { ...next[idx]!, ...patch };
    update({ fields: next });
  };
  const addField = () => {
    update({ fields: [...fields, { name: "", label: "", type: "text", required: false }] });
    setExpanded(fields.length);
  };
  const removeField = (idx: number) => {
    update({ fields: fields.filter((_, i) => i !== idx) });
    setExpanded(null);
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.form_title")}</label>
        <input className="input input--sm" value={String(node.title || "")} onChange={(e) => update({ title: e.target.value })} placeholder={t("workflows.form_title_hint")} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.form_description")}</label>
        <textarea className="input" rows={2} value={String(node.description || "")} onChange={(e) => update({ description: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.form_target")}</label>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.hitl_target_origin")}</option>
          <option value="specified">{t("workflows.hitl_target_specified")}</option>
        </select>
      </div>
      {target === "specified" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.hitl_channel")}</label>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.hitl_chat_id")}</label>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </div>
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_timeout")}</label>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 600000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
      </div>

      {/* Fields */}
      <div className="builder-row">
        <label className="label">{t("workflows.form_fields")}</label>
      </div>
      {fields.map((f, i) => (
        <div key={i} className="builder-nested-block">
          <div className="builder-row" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => setExpanded(expanded === i ? null : i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(expanded === i ? null : i); } }}>
            <span className="builder-nested-toggle">{expanded === i ? "▾" : "▸"}</span>
            <strong>{f.name || `Field ${i + 1}`}</strong>
            <span className="muted" style={{ marginLeft: 8 }}>{f.type}{f.required ? " *" : ""}</span>
            <button className="btn btn--xs btn--danger" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); removeField(i); }}>✕</button>
          </div>
          {expanded === i && (
            <>
              <div className="builder-row-pair">
                <div className="builder-row">
                  <label className="label">{t("workflows.form_field_name")}</label>
                  <input className="input input--sm" value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="field_name" />
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.form_field_label")}</label>
                  <input className="input input--sm" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Display Label" />
                </div>
              </div>
              <div className="builder-row-pair">
                <div className="builder-row">
                  <label className="label">{t("workflows.form_field_type")}</label>
                  <select className="input input--sm" value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FormFieldDef["type"] })}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="textarea">Textarea</option>
                    <option value="select">Select</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label-inline">
                    <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                    {t("workflows.form_field_required")}
                  </label>
                </div>
              </div>
              {f.type === "select" && (
                <div className="builder-row">
                  <label className="label">{t("workflows.form_field_options")}</label>
                  <input className="input input--sm" value={(f.options || []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="option1, option2, option3" />
                </div>
              )}
              <div className="builder-row">
                <label className="label">{t("workflows.form_field_default")}</label>
                <input className="input input--sm" value={f.default_value || ""} onChange={(e) => updateField(i, { default_value: e.target.value || undefined })} />
              </div>
            </>
          )}
        </div>
      ))}
      <button className="btn btn--sm" onClick={addField}>{t("workflows.form_add_field")}</button>
    </>
  );
}

export const form_descriptor: FrontendNodeDescriptor = {
  node_type: "form",
  icon: "📋",
  color: "#ff9800",
  shape: "rect",
  toolbar_label: "+ Form",
  category: "interaction",
  output_schema: [
    { name: "fields",       type: "object",  description: "Submitted field values" },
    { name: "submitted_by", type: "object",  description: "Submitter info" },
    { name: "submitted_at", type: "string",  description: "Submission timestamp" },
    { name: "timed_out",    type: "boolean", description: "Whether the form timed out" },
  ],
  input_schema: [
    { name: "prefill", type: "object", description: "Pre-fill values (override)" },
    { name: "context", type: "object", description: "Additional context data" },
  ],
  create_default: () => ({ title: "", description: "", target: "origin", fields: [], timeout_ms: 600000 }),
  EditPanel: FormEditPanel,
};
