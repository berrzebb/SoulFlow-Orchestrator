import { BuilderField, NodeMultiSelect } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

type SwitchCase = { value: string; targets: string[] };

function SwitchEditPanel({ node, update, t, options }: EditPanelProps) {
  const cases = (node.cases as SwitchCase[]) || [];
  const default_targets = (node.default_targets as string[]) || [];
  const wf_nodes = options?.workflow_nodes;

  const update_case = (i: number, patch: Partial<SwitchCase>) => {
    update({ cases: cases.map((c, j) => j === i ? { ...c, ...patch } : c) });
  };
  const add_case = () => update({ cases: [...cases, { value: "", targets: [] }] });
  const remove_case = (i: number) => update({ cases: cases.filter((_, j) => j !== i) });

  return (
    <>
      <BuilderField label={t("workflows.switch_expression")} hint={t("workflows.expression_hint")}>
        <input autoFocus className="input input--sm" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="memory.status" />
      </BuilderField>
      <div className="builder-row">
        <label className="label">{t("workflows.switch_cases")}</label>
        {cases.map((c, i) => (
          <div key={i} className="builder-nested-block">
            <div className="builder-inline-row" style={{ marginBottom: "4px" }}>
              <input className="input input--sm" style={{ flex: 1 }} value={c.value} onChange={(e) => update_case(i, { value: e.target.value })} placeholder="success" />
              <button type="button" className="btn btn--xs btn--danger" onClick={() => remove_case(i)}>✕</button>
            </div>
            <NodeMultiSelect value={c.targets} onChange={(ids) => update_case(i, { targets: ids })} nodes={wf_nodes} placeholder="target-node" />
          </div>
        ))}
        <button type="button" className="btn btn--xs" onClick={add_case}>+ {t("workflows.switch_add_case")}</button>
      </div>
      <BuilderField label={t("workflows.switch_default")}>
        <NodeMultiSelect value={default_targets} onChange={(ids) => update({ default_targets: ids })} nodes={wf_nodes} placeholder="fallback-node" />
      </BuilderField>
    </>
  );
}

export const switch_descriptor: FrontendNodeDescriptor = {
  node_type: "switch",
  icon: "⑆",
  color: "#ff9800",
  shape: "diamond",
  toolbar_label: "node.switch.label",
  category: "flow",
  output_schema: [
    { name: "matched_case", type: "string", description: "node.switch.output.matched_case" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "node.switch.input.value" },
  ],
  create_default: () => ({ expression: "value", cases: [{ value: "a", targets: [] }] }),
  EditPanel: SwitchEditPanel,
};
