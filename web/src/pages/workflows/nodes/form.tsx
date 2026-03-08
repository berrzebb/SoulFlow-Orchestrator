import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

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
      <BuilderField label={t("workflows.form_title")}>
        <input autoFocus className="input input--sm" value={String(node.title || "")} onChange={(e) => update({ title: e.target.value })} placeholder={t("workflows.form_title_hint")} />
      </BuilderField>
      <BuilderField label={t("workflows.form_description")}>
        <textarea className="input" rows={2} value={String(node.description || "")} onChange={(e) => update({ description: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("workflows.form_target")}>
        <select className="input input--sm" value={target} onChange={(e) => update({ target: e.target.value })}>
          <option value="origin">{t("workflows.hitl_target_origin")}</option>
          <option value="specified">{t("workflows.hitl_target_specified")}</option>
        </select>
      </BuilderField>
      {target === "specified" && (
        <div className="builder-row-pair builder-row--conditional">
          <BuilderField label={t("workflows.hitl_channel")}>
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label} ({c.provider})</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.hitl_chat_id")}>
            <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value })} />
          </BuilderField>
        </div>
      )}
      <BuilderField label={t("workflows.hitl_timeout")}>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 600000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
      </BuilderField>

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
            <button className="btn btn--xs btn--danger ml-auto" onClick={(e) => { e.stopPropagation(); removeField(i); }} aria-label={`${t("workflows.remove_item")} ${f.name || `Field ${i + 1}`}`}>
              <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1={2} y1={2} x2={10} y2={10} /><line x1={10} y1={2} x2={2} y2={10} /></svg>
            </button>
          </div>
          {expanded === i && (
            <>
              <div className="builder-row-pair">
                <BuilderField label={t("workflows.form_field_name")}>
                  <input className="input input--sm" value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="field_name" />
                </BuilderField>
                <BuilderField label={t("workflows.form_field_label")}>
                  <input className="input input--sm" value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder={t("workflows.field_label")} />
                </BuilderField>
              </div>
              <div className="builder-row-pair">
                <BuilderField label={t("workflows.form_field_type")}>
                  <select className="input input--sm" value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FormFieldDef["type"] })}>
                    <option value="text">{t("workflows.opt_text")}</option>
                    <option value="number">{t("workflows.opt_number")}</option>
                    <option value="textarea">{t("workflows.opt_textarea")}</option>
                    <option value="select">{t("workflows.opt_select")}</option>
                    <option value="boolean">{t("workflows.opt_boolean")}</option>
                  </select>
                </BuilderField>
                <div className="builder-row">
                  <label className="label-inline">
                    <input type="checkbox" checked={!!f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                    {t("workflows.form_field_required")}
                  </label>
                </div>
              </div>
              {f.type === "select" && (
                <BuilderField label={t("workflows.form_field_options")}>
                  <input className="input input--sm" value={(f.options || []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="option1, option2, option3" />
                </BuilderField>
              )}
              <BuilderField label={t("workflows.form_field_default")}>
                <input className="input input--sm" value={f.default_value || ""} onChange={(e) => updateField(i, { default_value: e.target.value || undefined })} />
              </BuilderField>
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
  toolbar_label: "node.form.label",
  category: "interaction",
  output_schema: [
    { name: "fields",       type: "object",  description: "node.form.output.fields" },
    { name: "submitted_by", type: "object",  description: "node.form.output.submitted_by" },
    { name: "submitted_at", type: "string",  description: "node.form.output.submitted_at" },
    { name: "timed_out",    type: "boolean", description: "node.form.output.timed_out" },
  ],
  input_schema: [
    { name: "prefill", type: "object", description: "node.form.input.prefill" },
    { name: "context", type: "object", description: "node.form.input.context" },
  ],
  create_default: () => ({ title: "", description: "", target: "origin", fields: [], timeout_ms: 600000 }),
  EditPanel: FormEditPanel,
};
