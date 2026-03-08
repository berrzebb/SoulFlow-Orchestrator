import { useState } from "react";
import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SwitchEditPanel({ node, update, t }: EditPanelProps) {
  const [casesRaw, setCasesRaw] = useState(JSON.stringify(node.cases || [], null, 2));
  const [casesErr, setCasesErr] = useState("");

  const handleCases = (val: string) => {
    setCasesRaw(val);
    if (!val.trim()) { setCasesErr(""); update({ cases: [] }); return; }
    try { update({ cases: JSON.parse(val) }); setCasesErr(""); }
    catch { setCasesErr(t("workflows.invalid_json")); }
  };

  return (
    <>
      <BuilderField label={t("workflows.switch_expression")} hint={t("workflows.expression_hint")}>
        <input autoFocus className="input input--sm" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="memory.status" />
      </BuilderField>
      <BuilderField label={t("workflows.switch_cases")} error={casesErr}>
        <textarea
          className={`input code-textarea${casesErr ? " input--err" : ""}`}
          rows={4}
          value={casesRaw}
          onChange={(e) => handleCases(e.target.value)}
          spellCheck={false}
          placeholder='[{"value": "success", "targets": ["next-1"]}]'
        />
      </BuilderField>
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
