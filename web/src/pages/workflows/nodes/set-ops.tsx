import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SetOpsEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "union");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["union", "intersection", "difference", "symmetric_difference", "is_subset", "is_superset", "equals", "power_set", "cartesian_product"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_set_a")}</label>
        <textarea className="input code-textarea" rows={2} value={String(node.a || "")} onChange={(e) => update({ a: e.target.value })} placeholder='[1, 2, 3]' />
      </div>
      {op !== "power_set" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_set_b")}</label>
          <textarea className="input code-textarea" rows={2} value={String(node.b || "")} onChange={(e) => update({ b: e.target.value })} placeholder='[2, 3, 4]' />
        </div>
      )}
    </>
  );
}

export const set_ops_descriptor: FrontendNodeDescriptor = {
  node_type: "set_ops",
  icon: "\u{1F300}",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.set_ops.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.set_ops.output.result" },
    { name: "success", type: "boolean", description: "node.set_ops.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.set_ops.input.operation" },
    { name: "a",         type: "string", description: "node.set_ops.input.a" },
  ],
  create_default: () => ({ operation: "union", a: "", b: "" }),
  EditPanel: SetOpsEditPanel,
};
