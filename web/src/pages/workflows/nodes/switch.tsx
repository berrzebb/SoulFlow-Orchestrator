import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SwitchEditPanel({ node, update, t }: EditPanelProps) {
  const [casesRaw, setCasesRaw] = useState(JSON.stringify(node.cases || [], null, 2));
  const [casesErr, setCasesErr] = useState("");

  const handleCases = (val: string) => {
    setCasesRaw(val);
    if (!val.trim()) { setCasesErr(""); update({ cases: [] }); return; }
    try { update({ cases: JSON.parse(val) }); setCasesErr(""); }
    catch { setCasesErr("Invalid JSON"); }
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.switch_expression")}</label>
        <input className="input input--sm" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="memory.status" />
        <span className="builder-hint">{t("workflows.expression_hint") || "Access previous results via memory.prev.*, input.*, or value"}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.switch_cases")}</label>
        <textarea
          className={`input code-textarea${casesErr ? " input--err" : ""}`}
          rows={4}
          value={casesRaw}
          onChange={(e) => handleCases(e.target.value)}
          spellCheck={false}
          placeholder='[{"value": "success", "targets": ["next-1"]}]'
        />
        {casesErr && <span className="field-error">{casesErr}</span>}
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.switch_default")}</label>
        <input className="input input--sm" value={((node.default_targets as string[]) || []).join(", ")} onChange={(e) => update({ default_targets: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="fallback-node" />
      </div>
    </>
  );
}

export const switch_descriptor: FrontendNodeDescriptor = {
  node_type: "switch",
  icon: "⑆",
  color: "#ff9800",
  shape: "diamond",
  toolbar_label: "+ Switch",
  category: "flow",
  output_schema: [
    { name: "matched_case", type: "string", description: "Matched case value" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "Value to evaluate" },
  ],
  create_default: () => ({ expression: "value", cases: [{ value: "a", targets: [] }] }),
  EditPanel: SwitchEditPanel,
};
