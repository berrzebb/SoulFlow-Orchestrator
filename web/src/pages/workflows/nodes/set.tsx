import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SetEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <div className="builder-row">
      <label className="label">{t("workflows.set_assignments")}</label>
      <textarea
        className="input code-textarea"
        rows={4}
        value={JSON.stringify(node.assignments || [], null, 2)}
        onChange={(e) => { try { update({ assignments: JSON.parse(e.target.value) }); } catch { /* ignore */ } }}
        spellCheck={false}
        placeholder='[{"key": "result", "value": "{{memory.http-1.body}}"}]'
      />
    </div>
  );
}

export const set_descriptor: FrontendNodeDescriptor = {
  node_type: "set",
  icon: "=",
  color: "#1abc9c",
  shape: "rect",
  toolbar_label: "+ Set",
  output_schema: [],  // 동적: assignments에서 추출
  input_schema: [],
  create_default: () => ({ assignments: [] }),
  EditPanel: SetEditPanel,
};
