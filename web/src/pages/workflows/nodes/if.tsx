import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function IfEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.if_condition")}</label>
        <input className="input input--sm" value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} placeholder="memory.prev.status === 200" />
        <span className="builder-hint">{t("workflows.condition_hint") || "JS expression. Available: memory.*, input.*, value, prev"}</span>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.if_true_targets") || "True → targets"}</label>
          <input className="input input--sm" value={((node.true_targets as string[]) || []).join(", ")} onChange={(e) => update({ true_targets: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="next-node" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.if_false_targets") || "False → targets"}</label>
          <input className="input input--sm" value={((node.false_targets as string[]) || []).join(", ")} onChange={(e) => update({ false_targets: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="fallback-node" />
        </div>
      </div>
    </>
  );
}

export const if_descriptor: FrontendNodeDescriptor = {
  node_type: "if",
  icon: "?",
  color: "#f39c12",
  shape: "diamond",
  toolbar_label: "+ IF",
  output_schema: [
    { name: "branch",           type: "string",  description: '"true" or "false"' },
    { name: "condition_result", type: "boolean", description: "Evaluated condition" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "Value to evaluate" },
  ],
  create_default: () => ({ condition: "true" }),
  EditPanel: IfEditPanel,
};
