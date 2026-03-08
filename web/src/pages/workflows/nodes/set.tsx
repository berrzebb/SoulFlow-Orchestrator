import { useState } from "react";
import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SetEditPanel({ node, update, t }: EditPanelProps) {
  const [raw, setRaw] = useState(JSON.stringify(node.assignments || [], null, 2));
  const [err, setErr] = useState("");

  const handleChange = (val: string) => {
    setRaw(val);
    if (!val.trim()) { setErr(""); update({ assignments: [] }); return; }
    try { update({ assignments: JSON.parse(val) }); setErr(""); }
    catch { setErr(t("workflows.invalid_json")); }
  };

  return (
    <BuilderField label={t("workflows.set_assignments")} hint={t("workflows.set_hint")} error={err}>
      <textarea
        autoFocus
        className={`input code-textarea${err ? " input--err" : ""}`}
        rows={4}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        placeholder='[{"key": "result", "value": "{{memory.http-1.body}}"}]'
      />
    </BuilderField>
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
