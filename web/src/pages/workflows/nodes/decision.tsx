import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DecisionEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "append");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.decision_op") || "Operation"}</label>
          <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <option value="append">Append</option>
            <option value="list">List</option>
            <option value="get_effective">Get Effective</option>
            <option value="archive">Archive</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.decision_scope") || "Scope"}</label>
          <select className="input input--sm" value={String(node.scope || "global")} onChange={(e) => update({ scope: e.target.value })}>
            <option value="global">Global</option>
            <option value="team">Team</option>
            <option value="agent">Agent</option>
          </select>
        </div>
      </div>
      {(op === "append") && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.decision_key") || "Key"}</label>
            <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="coding_style" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.decision_value") || "Value"}</label>
            <textarea className="input" rows={2} value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="Always use TypeScript strict mode" />
          </div>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.decision_priority") || "Priority"}</label>
              <select className="input input--sm" value={String(node.priority ?? 1)} onChange={(e) => update({ priority: Number(e.target.value) })}>
                <option value="0">P0 (Critical)</option>
                <option value="1">P1 (Normal)</option>
                <option value="2">P2 (Low)</option>
                <option value="3">P3 (Info)</option>
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.decision_tags") || "Tags"}</label>
              <input className="input input--sm" value={Array.isArray(node.tags) ? (node.tags as string[]).join(", ") : ""} onChange={(e) => update({ tags: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="style, code" />
            </div>
          </div>
        </>
      )}
      {op === "archive" && (
        <div className="builder-row">
          <label className="label">{t("workflows.decision_target") || "Target ID"}</label>
          <input className="input input--sm" value={String(node.target_id || "")} onChange={(e) => update({ target_id: e.target.value })} placeholder="decision-id-123" />
        </div>
      )}
    </>
  );
}

export const decision_descriptor: FrontendNodeDescriptor = {
  node_type: "decision",
  icon: "⚖",
  color: "#795548",
  shape: "rect",
  toolbar_label: "+ Decision",
  output_schema: [
    { name: "action",  type: "string", description: "Result action" },
    { name: "record",  type: "object", description: "Decision record" },
    { name: "records", type: "array",  description: "Listed records" },
    { name: "count",   type: "number", description: "Record count" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "append | list | get_effective | archive" },
    { name: "key",       type: "string", description: "Decision key" },
    { name: "value",     type: "string", description: "Decision value" },
  ],
  create_default: () => ({ operation: "append", scope: "global", key: "", value: "" }),
  EditPanel: DecisionEditPanel,
};
