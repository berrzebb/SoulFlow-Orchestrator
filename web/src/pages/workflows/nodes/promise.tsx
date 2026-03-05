import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function PromiseEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "append");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.promise_op") || "Operation"}</label>
          <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <option value="append">Append</option>
            <option value="list">List</option>
            <option value="get_effective">Get Effective</option>
            <option value="archive">Archive</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.promise_scope") || "Scope"}</label>
          <select className="input input--sm" value={String(node.scope || "global")} onChange={(e) => update({ scope: e.target.value })}>
            <option value="global">Global</option>
            <option value="team">Team</option>
            <option value="agent">Agent</option>
          </select>
        </div>
      </div>
      {op === "append" && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.promise_key") || "Key"}</label>
            <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="never_delete_without_backup" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.promise_value") || "Value"}</label>
            <textarea className="input" rows={2} value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="I will always create a backup before deleting data" />
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
              <input className="input input--sm" value={Array.isArray(node.tags) ? (node.tags as string[]).join(", ") : ""} onChange={(e) => update({ tags: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="safety, data" />
            </div>
          </div>
        </>
      )}
      {op === "archive" && (
        <div className="builder-row">
          <label className="label">{t("workflows.promise_target") || "Target ID"}</label>
          <input className="input input--sm" value={String(node.target_id || "")} onChange={(e) => update({ target_id: e.target.value })} placeholder="promise-id-456" />
        </div>
      )}
    </>
  );
}

export const promise_descriptor: FrontendNodeDescriptor = {
  node_type: "promise",
  icon: "🤝",
  color: "#009688",
  shape: "rect",
  toolbar_label: "+ Promise",
  output_schema: [
    { name: "action",  type: "string", description: "Result action" },
    { name: "record",  type: "object", description: "Promise record" },
    { name: "records", type: "array",  description: "Listed records" },
    { name: "count",   type: "number", description: "Record count" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "append | list | get_effective | archive" },
    { name: "key",       type: "string", description: "Promise key" },
    { name: "value",     type: "string", description: "Promise value" },
  ],
  create_default: () => ({ operation: "append", scope: "global", key: "", value: "" }),
  EditPanel: PromiseEditPanel,
};
