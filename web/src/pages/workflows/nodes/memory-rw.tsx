import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MemoryRwEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.memory_rw.input.action")}</label>
        <input autoFocus className="input input--sm" value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.memory_rw.input.key")}</label>
        <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.memory_rw.input.value")}</label>
        <input className="input input--sm" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} />
      </div>
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
  create_default: () => ({ action: "", key: "", value: "" }),
  EditPanel: MemoryRwEditPanel,
};
