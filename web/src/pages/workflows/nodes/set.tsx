import { useState } from "react";
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
    <div className="builder-row">
      <label className="label">{t("workflows.set_assignments")}</label>
      <textarea
        className={`input code-textarea${err ? " input--err" : ""}`}
        rows={4}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        placeholder='[{"key": "result", "value": "{{memory.http-1.body}}"}]'
      />
      {err && <span className="field-error">{err}</span>}
      <span className="builder-hint">{t("workflows.set_hint") || 'Array of {key, value} pairs. Use {{memory.*}} for references.'}</span>
    </div>
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
