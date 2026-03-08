import { JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SetEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <JsonField label={t("workflows.set_assignments")} hint={t("workflows.set_hint")} value={node.assignments || []} onUpdate={(v) => update({ assignments: (v as unknown[]) ?? [] })} rows={4} autoFocus placeholder='[{"key": "result", "value": "{{memory.http-1.body}}"}]' emptyValue={[]} />
  );
}

export const set_descriptor: FrontendNodeDescriptor = {
  node_type: "set",
  icon: "=",
  color: "#1abc9c",
  shape: "rect",
  toolbar_label: "node.set.label",
  category: "data",
  output_schema: [],  // 동적: assignments에서 추출
  input_schema: [],
  create_default: () => ({ assignments: [] }),
  EditPanel: SetEditPanel,
};
