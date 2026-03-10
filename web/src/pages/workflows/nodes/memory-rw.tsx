import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const ACTIONS = ["get", "set", "delete", "list"];

function MemoryRwEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "get");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {action !== "list" && (
          <BuilderField label={t("node.memory_rw.input.key")} required>
            <input className="input input--sm" required value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="my_key" aria-required="true" />
          </BuilderField>
        )}
      </BuilderRowPair>
      {action === "set" && (
        <BuilderField label={t("node.memory_rw.input.value")}>
          <input className="input input--sm" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="{{memory.result}}" />
        </BuilderField>
      )}
    </>
  );
}

export const memory_rw_descriptor: FrontendNodeDescriptor = {
  node_type: "memory_rw",
  icon: "🧠",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.memory_rw.label",
  category: "data",
  output_schema: [
    { name: "value", type: "string", description: "node.memory_rw.output.value" },
    { name: "success", type: "boolean", description: "node.memory_rw.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.memory_rw.input.action" },
    { name: "key", type: "string", description: "node.memory_rw.input.key" },
    { name: "value", type: "string", description: "node.memory_rw.input.value" },
  ],
  create_default: () => ({ action: "get", key: "", value: "" }),
  EditPanel: MemoryRwEditPanel,
};
