import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "format", "to_ms", "from_ms", "add", "subtract", "humanize", "compare"];

function DurationEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_input")} required>
        <input className="input input--sm" required value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={action === "from_ms" ? "86400000" : "1h30m"} aria-required="true" />
      </BuilderField>
      {(action === "add" || action === "subtract" || action === "compare") && (
        <BuilderField label={t("workflows.field_duration_2")} required>
          <input className="input input--sm" required value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder="30m" aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const duration_descriptor: FrontendNodeDescriptor = {
  node_type: "duration",
  icon: "⏱️",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.duration.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.duration.output.result" },
    { name: "success", type: "boolean", description: "node.duration.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.duration.input.action" },
    { name: "input", type: "string", description: "node.duration.input.input" },
  ],
  create_default: () => ({ action: "parse", input: "" }),
  EditPanel: DurationEditPanel,
};
