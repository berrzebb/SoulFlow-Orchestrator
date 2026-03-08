import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LoopEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_array")}</label>
        <input autoFocus className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="items" aria-label={t("workflows.loop_array")} />
        <span className="builder-hint">{t("workflows.loop_array_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_body")}</label>
        <input className="input input--sm" value={Array.isArray(node.body_nodes) ? (node.body_nodes as string[]).join(", ") : ""} onChange={(e) => update({ body_nodes: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="code-1, http-1" aria-label={t("workflows.loop_body")} />
        <span className="builder-hint">{t("workflows.loop_body_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.loop_max")}</label>
        <input className="input input--sm" type="number" min={1} max={10000} value={String(node.max_iterations ?? 100)} onChange={(e) => update({ max_iterations: Number(e.target.value) || 100 })} aria-label={t("workflows.loop_max")} />
        <span className="builder-hint">{t("workflows.loop_max_hint")}</span>
      </div>
    </>
  );
}

export const loop_descriptor: FrontendNodeDescriptor = {
  node_type: "loop",
  icon: "⟳",
  color: "#8e44ad",
  shape: "rect",
  toolbar_label: "node.loop.label",
  category: "flow",
  output_schema: [
    { name: "item",    type: "unknown", description: "node.loop.output.item" },
    { name: "index",   type: "number",  description: "node.loop.output.index" },
    { name: "total",   type: "number",  description: "node.loop.output.total" },
    { name: "results", type: "array",   description: "node.loop.output.results" },
  ],
  input_schema: [
    { name: "array", type: "array", description: "node.loop.input.array" },
  ],
  create_default: () => ({ array_field: "items", body_nodes: [], max_iterations: 100 }),
  EditPanel: LoopEditPanel,
};
