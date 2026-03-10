import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "format", "validate", "normalize", "country_info", "compare"];
const FORMAT_TYPES = ["e164", "international", "national", "rfc3966"];

function PhoneEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.phone_country")}>
          <input className="input input--sm" value={String(node.country || "")} onChange={(e) => update({ country: e.target.value })} placeholder="US" style={{ maxWidth: "80px" }} />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.phone_number")} required>
        <input className="input input--sm" required value={String(node.number || "")} onChange={(e) => update({ number: e.target.value })} placeholder="+1-555-555-5555" aria-required="true" />
      </BuilderField>
      {action === "compare" && (
        <BuilderField label={t("workflows.phone_number_2")} required>
          <input className="input input--sm" required value={String(node.number2 || "")} onChange={(e) => update({ number2: e.target.value })} placeholder="+1-555-555-5556" aria-required="true" />
        </BuilderField>
      )}
      {action === "format" && (
        <BuilderField label={t("workflows.phone_format_type")}>
          <select className="input input--sm" value={String(node.format_type || "e164")} onChange={(e) => update({ format_type: e.target.value })}>
            {FORMAT_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </BuilderField>
      )}
    </>
  );
}

export const phone_descriptor: FrontendNodeDescriptor = {
  node_type: "phone",
  icon: "☎️",
  color: "#0288d1",
  shape: "rect",
  toolbar_label: "node.phone.label",
  category: "data",
  output_schema: [
    { name: "result", type: "object", description: "node.phone.output.result" },
    { name: "success", type: "boolean", description: "node.phone.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.phone.input.action" },
    { name: "number", type: "string", description: "node.phone.input.number" },
  ],
  create_default: () => ({ action: "parse", number: "", country: "" }),
  EditPanel: PhoneEditPanel,
};
