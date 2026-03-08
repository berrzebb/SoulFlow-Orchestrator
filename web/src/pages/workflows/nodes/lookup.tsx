import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function LookupEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.field_table")}>
        <select autoFocus className="input input--sm" value={String(node.table || "http_status")} onChange={(e) => update({ table: e.target.value })}>
          {["http_status", "mime_type", "country", "currency_symbol"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_key")}>
        <input className="input" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="404" />
      </BuilderField>
      <BuilderRowPair>
        <div className="builder-row">
          <label className="label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input type="checkbox" checked={Boolean(node.reverse)} onChange={(e) => update({ reverse: e.target.checked })} />
            Reverse
          </label>
        </div>
        <div className="builder-row">
          <label className="label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input type="checkbox" checked={Boolean(node.list)} onChange={(e) => update({ list: e.target.checked })} />
            List All
          </label>
        </div>
      </BuilderRowPair>
    </>
  );
}

export const lookup_descriptor: FrontendNodeDescriptor = {
  node_type: "lookup",
  icon: "\u{1F50D}",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.lookup.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.lookup.output.result" },
    { name: "success", type: "boolean", description: "node.lookup.output.success" },
  ],
  input_schema: [
    { name: "table", type: "string", description: "node.lookup.input.table" },
    { name: "key",   type: "string", description: "node.lookup.input.key" },
  ],
  create_default: () => ({ table: "http_status", key: "", reverse: false, list: false }),
  EditPanel: LookupEditPanel,
};
