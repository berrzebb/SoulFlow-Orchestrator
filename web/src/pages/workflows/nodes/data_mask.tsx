import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["mask_email", "mask_phone", "mask_card", "mask_ip", "detect_pii", "redact", "custom_mask"];

function DataMaskEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "detect_pii");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_text")} required>
        <textarea className="input" required rows={3} value={String(node.text || "")} onChange={(e) => update({ text: e.target.value })} placeholder="Contact: john@example.com" aria-required="true" />
      </BuilderField>
      {action === "custom_mask" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_pattern_regex")} required>
            <input className="input input--sm" required value={String(node.pattern || "")} onChange={(e) => update({ pattern: e.target.value })} placeholder="\d{4}-\d{4}" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.field_replacement")}>
            <input className="input input--sm" value={String(node.replacement || "[MASKED]")} onChange={(e) => update({ replacement: e.target.value })} placeholder="[MASKED]" />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const data_mask_descriptor: FrontendNodeDescriptor = {
  node_type: "data_mask",
  icon: "🎭",
  color: "#b71c1c",
  shape: "rect",
  toolbar_label: "node.data_mask.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.data_mask.output.result" },
    { name: "success", type: "boolean", description: "node.data_mask.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.data_mask.input.action" },
    { name: "text", type: "string", description: "node.data_mask.input.text" },
  ],
  create_default: () => ({ action: "detect_pii", text: "", pattern: "", replacement: "[MASKED]" }),
  EditPanel: DataMaskEditPanel,
};
