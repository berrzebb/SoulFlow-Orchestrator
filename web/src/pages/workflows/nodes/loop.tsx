import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LoopEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_array") || "Array Field"}</label>
        <input className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="items" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_body") || "Body Nodes"}</label>
        <input className="input input--sm" value={Array.isArray(node.body_nodes) ? (node.body_nodes as string[]).join(", ") : ""} onChange={(e) => update({ body_nodes: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="code-1, http-1" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_max") || "Max Iterations"}</label>
        <input className="input input--sm" type="number" min={1} max={10000} value={String(node.max_iterations ?? 100)} onChange={(e) => update({ max_iterations: Number(e.target.value) || 100 })} />
      </div>
    </>
  );
}

export const loop_descriptor: FrontendNodeDescriptor = {
  node_type: "loop",
  icon: "⟳",
  color: "#8e44ad",
  shape: "rect",
  toolbar_label: "+ Loop",
  output_schema: [
    { name: "item",    type: "unknown", description: "Current iteration item" },
    { name: "index",   type: "number",  description: "Current iteration index" },
    { name: "total",   type: "number",  description: "Total item count" },
    { name: "results", type: "array",   description: "Collected results from body" },
  ],
  input_schema: [
    { name: "array", type: "array", description: "Array to iterate over" },
  ],
  create_default: () => ({ array_field: "items", body_nodes: [], max_iterations: 100 }),
  EditPanel: LoopEditPanel,
};
