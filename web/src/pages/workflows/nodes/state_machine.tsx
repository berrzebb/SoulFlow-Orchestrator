import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["define", "transition", "validate", "visualize", "reachable", "history"];

function StateMachineEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "define");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <JsonField label={t("workflows.state_machine_definition")} value={node.machine} onUpdate={(v) => update({ machine: v })} placeholder='{"initial": "idle", "states": {...}}' />
      {action !== "define" && action !== "validate" && action !== "visualize" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.state_machine_current_state")}>
            <input className="input input--sm" value={String(node.current || "")} onChange={(e) => update({ current: e.target.value })} placeholder="idle" />
          </BuilderField>
          {action === "transition" && (
            <BuilderField label={t("workflows.field_event")} required>
              <input className="input input--sm" required value={String(node.event || "")} onChange={(e) => update({ event: e.target.value })} placeholder="start" aria-required="true" />
            </BuilderField>
          )}
        </BuilderRowPair>
      )}
      {action === "reachable" && (
        <BuilderField label={t("workflows.state_machine_events")}>
          <input className="input input--sm" value={String(node.events || "")} onChange={(e) => update({ events: e.target.value })} placeholder="start,stop (comma-separated)" />
        </BuilderField>
      )}
    </>
  );
}

export const state_machine_descriptor: FrontendNodeDescriptor = {
  node_type: "state_machine",
  icon: "🔄",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.state_machine.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.state_machine.output.result" },
    { name: "success", type: "boolean", description: "node.state_machine.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.state_machine.input.action" },
    { name: "machine", type: "string", description: "node.state_machine.input.machine" },
  ],
  create_default: () => ({ action: "define", machine: "", current: "", event: "", events: "" }),
  EditPanel: StateMachineEditPanel,
};
