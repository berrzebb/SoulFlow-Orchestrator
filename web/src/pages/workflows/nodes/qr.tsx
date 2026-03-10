import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["generate", "text"];
const FORMATS = ["svg", "text"];

function QrEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_format")}>
          <select className="input input--sm" value={String(node.format || "svg")} onChange={(e) => update({ format: e.target.value })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_data")} required>
        <input className="input input--sm" required value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder="https://example.com" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const qr_descriptor: FrontendNodeDescriptor = {
  node_type: "qr",
  icon: "📱",
  color: "#212121",
  shape: "rect",
  toolbar_label: "node.qr.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.qr.output.result" },
    { name: "success", type: "boolean", description: "node.qr.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.qr.input.action" },
    { name: "data", type: "string", description: "node.qr.input.data" },
  ],
  create_default: () => ({ action: "generate", data: "", format: "svg" }),
  EditPanel: QrEditPanel,
};
