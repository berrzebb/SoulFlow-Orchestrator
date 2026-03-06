import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

interface AssertionDef {
  condition: string;
  message: string;
}

function AssertEditPanel({ node, update, t }: EditPanelProps) {
  const assertions = (node.assertions || []) as AssertionDef[];
  const [expanded, setExpanded] = useState<number | null>(null);

  const updateAssertion = (idx: number, patch: Partial<AssertionDef>) => {
    const next = [...assertions];
    next[idx] = { ...next[idx]!, ...patch };
    update({ assertions: next });
  };
  const addAssertion = () => {
    update({ assertions: [...assertions, { condition: "", message: "" }] });
    setExpanded(assertions.length);
  };
  const removeAssertion = (idx: number) => {
    update({ assertions: assertions.filter((_, i) => i !== idx) });
    setExpanded(null);
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.assert_on_fail")}</label>
        <select className="input input--sm" value={String(node.on_fail || "halt")} onChange={(e) => update({ on_fail: e.target.value })}>
          <option value="halt">{t("workflows.assert_on_fail_halt")}</option>
          <option value="continue">{t("workflows.assert_on_fail_continue")}</option>
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.assert_error_message")}</label>
        <input className="input input--sm" value={String(node.error_message || "")} onChange={(e) => update({ error_message: e.target.value })} placeholder={t("workflows.assert_error_message_hint")} />
      </div>

      <div className="builder-row">
        <label className="label">{t("workflows.assert_list")}</label>
      </div>
      {assertions.map((a, i) => (
        <div key={i} className="builder-nested-block">
          <div className="builder-row" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => setExpanded(expanded === i ? null : i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(expanded === i ? null : i); } }}>
            <span className="builder-nested-toggle">{expanded === i ? "▾" : "▸"}</span>
            <code style={{ fontSize: 12 }}>{a.condition || `Assertion ${i + 1}`}</code>
            <button className="btn btn--xs btn--danger" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); removeAssertion(i); }}>✕</button>
          </div>
          {expanded === i && (
            <>
              <div className="builder-row">
                <label className="label">{t("workflows.assert_condition")}</label>
                <input className="input input--sm" value={a.condition} onChange={(e) => updateAssertion(i, { condition: e.target.value })} placeholder="memory.count > 0" />
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.assert_message")}</label>
                <input className="input input--sm" value={a.message} onChange={(e) => updateAssertion(i, { message: e.target.value })} placeholder="Count must be positive" />
              </div>
            </>
          )}
        </div>
      ))}
      <button className="btn btn--sm" onClick={addAssertion}>{t("workflows.assert_add")}</button>
    </>
  );
}

export const assert_descriptor: FrontendNodeDescriptor = {
  node_type: "assert",
  icon: "🛡",
  color: "#e91e63",
  shape: "diamond",
  toolbar_label: "+ Assert",
  category: "flow",
  output_schema: [
    { name: "valid",   type: "boolean", description: "Whether all assertions passed" },
    { name: "errors",  type: "array",   description: "Validation error messages" },
    { name: "checked", type: "number",  description: "Number of assertions checked" },
  ],
  input_schema: [
    { name: "data", type: "unknown", description: "Data to validate" },
  ],
  create_default: () => ({ assertions: [], on_fail: "halt", error_message: "" }),
  EditPanel: AssertEditPanel,
};
