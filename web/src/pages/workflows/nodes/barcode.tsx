import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["generate", "validate_ean", "parse_ean", "checksum_ean"];
const FORMATS = ["code128", "ean13", "code39"];

function BarcodeEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {action === "generate" && (
          <BuilderField label={t("workflows.field_format")}>
            <select className="input input--sm" value={String(node.format || "code128")} onChange={(e) => update({ format: e.target.value })}>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_data")} required>
        <input className="input input--sm" required value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder="1234567890128" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const barcode_descriptor: FrontendNodeDescriptor = {
  node_type: "barcode",
  icon: "📶",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.barcode.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.barcode.output.result" },
    { name: "success", type: "boolean", description: "node.barcode.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.barcode.input.action" },
    { name: "data", type: "string", description: "node.barcode.input.data" },
  ],
  create_default: () => ({ action: "generate", data: "", format: "code128" }),
  EditPanel: BarcodeEditPanel,
};
