import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function FormatEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "number");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["number", "currency", "percent", "bytes", "relative_time", "mask", "ordinal", "plural", "duration", "pad", "truncate"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_value")}>
        <input className="input" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder={op === "bytes" ? "1073741824" : "12345.67"} />
      </BuilderField>
      {["number", "currency", "percent"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_locale")}>
            <input className="input input--sm" value={String(node.locale || "en-US")} onChange={(e) => update({ locale: e.target.value })} />
          </BuilderField>
          {op === "currency" && (
            <BuilderField label={t("workflows.field_currency")}>
              <input className="input input--sm" value={String(node.currency || "USD")} onChange={(e) => update({ currency: e.target.value })} placeholder="USD" />
            </BuilderField>
          )}
        </BuilderRowPair>
      )}
      {op === "mask" && (
        <BuilderField label={t("workflows.field_mask_type")}>
          <select className="input input--sm" value={String(node.mask_type || "custom")} onChange={(e) => update({ mask_type: e.target.value })}>
            {["email", "phone", "card", "custom"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </BuilderField>
      )}
      {op === "truncate" && (
        <BuilderField label={t("workflows.field_max_length")}>
          <input className="input input--sm" type="number" min={1} value={String(node.max_length ?? 50)} onChange={(e) => update({ max_length: Number(e.target.value) })} />
        </BuilderField>
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
