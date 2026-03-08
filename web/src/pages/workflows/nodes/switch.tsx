import { BuilderField, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SwitchEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.switch_expression")} hint={t("workflows.expression_hint")}>
        <input autoFocus className="input input--sm" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="memory.status" />
      </BuilderField>
      <JsonField label={t("workflows.switch_cases")} value={node.cases || []} onUpdate={(v) => update({ cases: (v as unknown[]) ?? [] })} rows={4} placeholder='[{"value": "success", "targets": ["next-1"]}]' emptyValue={[]} />
      <BuilderField label={t("workflows.switch_default")}>
        <input className="input input--sm" value={((node.default_targets as string[]) || []).join(", ")} onChange={(e) => update({ default_targets: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="fallback-node" />
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
