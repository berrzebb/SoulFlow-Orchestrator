import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "format", "to_ms", "from_ms", "add", "subtract", "humanize", "compare"];

function DurationEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {action === "from_ms" ? (
        <BuilderField label={t("workflows.duration_ms")} required>
          <input className="input input--sm" required type="number" min={0} value={String(node.ms ?? "")} onChange={(e) => update({ ms: e.target.value ? Number(e.target.value) : undefined })} placeholder="86400000" aria-required="true" />
        </BuilderField>
      ) : (
        <BuilderField label={t("workflows.field_input")} required>
          <input className="input input--sm" required value={String(node.duration || "")} onChange={(e) => update({ duration: e.target.value })} placeholder="1h30m" aria-required="true" />
        </BuilderField>
      )}
      {(action === "add" || action === "subtract" || action === "compare") && (
        <BuilderField label={t("workflows.field_duration_2")} required>
          <input className="input input--sm" required value={String(node.duration2 || "")} onChange={(e) => update({ duration2: e.target.value })} placeholder="30m" aria-required="true" />
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
    { name: "result", type: "object", description: "node.duration.output.result" },
    { name: "success", type: "boolean", description: "node.duration.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.duration.input.action" },
    { name: "duration", type: "string", description: "node.duration.input.duration" },
  ],
  create_default: () => ({ action: "parse", duration: "", duration2: "", ms: 0 }),
  EditPanel: DurationEditPanel,
};
