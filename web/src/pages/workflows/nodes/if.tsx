import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function IfEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.if_condition")} hint={t("workflows.condition_hint")}>
        <input autoFocus className="input input--sm" value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} placeholder="memory.prev.status === 200" />
      </BuilderField>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.if_true_branch")}>
          <input className="input input--sm" value={(((node.outputs as Record<string, unknown>)?.true_branch as string[]) || []).join(", ")} onChange={(e) => update({ outputs: { ...((node.outputs as Record<string, unknown>) || {}), true_branch: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) } })} placeholder="next-node" />
        </BuilderField>
        <BuilderField label={t("workflows.if_false_branch")}>
          <input className="input input--sm" value={(((node.outputs as Record<string, unknown>)?.false_branch as string[]) || []).join(", ")} onChange={(e) => update({ outputs: { ...((node.outputs as Record<string, unknown>) || {}), false_branch: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) } })} placeholder="fallback-node" />
        </BuilderField>
      </div>
    </>
  );
}

export const if_descriptor: FrontendNodeDescriptor = {
  node_type: "if",
  icon: "?",
  color: "#f39c12",
  shape: "diamond",
  toolbar_label: "node.if.label",
  category: "flow",
  output_schema: [
    { name: "branch",           type: "string",  description: '"true" or "false"' },
    { name: "condition_result", type: "boolean", description: "node.if.output.condition_result" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "node.if.input.value" },
  ],
  create_default: () => ({ condition: "true" }),
  EditPanel: IfEditPanel,
};
