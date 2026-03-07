import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FormatEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "number");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["number", "currency", "percent", "bytes", "relative_time", "mask", "ordinal", "plural", "duration", "pad", "truncate"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_value")}</label>
        <input className="input" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder={op === "bytes" ? "1073741824" : "12345.67"} />
      </div>
      {["number", "currency", "percent"].includes(op) && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.field_locale")}</label>
            <input className="input input--sm" value={String(node.locale || "en-US")} onChange={(e) => update({ locale: e.target.value })} />
          </div>
          {op === "currency" && (
            <div className="builder-row">
              <label className="label">{t("workflows.field_currency")}</label>
              <input className="input input--sm" value={String(node.currency || "USD")} onChange={(e) => update({ currency: e.target.value })} placeholder="USD" />
            </div>
          )}
        </div>
      )}
      {op === "mask" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_mask_type")}</label>
          <select className="input input--sm" value={String(node.mask_type || "custom")} onChange={(e) => update({ mask_type: e.target.value })}>
            {["email", "phone", "card", "custom"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
      {op === "truncate" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_max_length")}</label>
          <input className="input input--sm" type="number" min={1} value={String(node.max_length ?? 50)} onChange={(e) => update({ max_length: Number(e.target.value) })} />
        </div>
      )}
    </>
  );
}

export const format_descriptor: FrontendNodeDescriptor = {
  node_type: "format",
  icon: "\u{1F3AF}",
  color: "#00838f",
  shape: "rect",
  toolbar_label: "node.format.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.format.output.result" },
    { name: "success", type: "boolean", description: "node.format.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.format.input.operation" },
    { name: "value",     type: "string", description: "node.format.input.value" },
  ],
  create_default: () => ({ operation: "number", value: "", locale: "en-US", currency: "USD", decimals: 2, mask_type: "custom", max_length: 50 }),
  EditPanel: FormatEditPanel,
};
