import { BuilderField, NodeMultiSelect } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function IfEditPanel({ node, update, t, options }: EditPanelProps) {
  const outputs = (node.outputs as Record<string, unknown>) || {};
  const true_branch = (outputs.true_branch as string[]) || [];
  const false_branch = (outputs.false_branch as string[]) || [];
  const wf_nodes = options?.workflow_nodes;

  return (
    <>
      <BuilderField label={t("workflows.if_condition")} hint={t("workflows.condition_hint")}>
        <input autoFocus className="input input--sm" value={String(node.condition || "")} onChange={(e) => update({ condition: e.target.value })} placeholder="memory.prev.status === 200" />
      </BuilderField>
      <BuilderField label={t("workflows.if_true_branch")}>
        <NodeMultiSelect value={true_branch} onChange={(ids) => update({ outputs: { ...outputs, true_branch: ids } })} nodes={wf_nodes} placeholder="next-node" />
      </BuilderField>
      <BuilderField label={t("workflows.if_false_branch")}>
        <NodeMultiSelect value={false_branch} onChange={(ids) => update({ outputs: { ...outputs, false_branch: ids } })} nodes={wf_nodes} placeholder="fallback-node" />
      </BuilderField>
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
