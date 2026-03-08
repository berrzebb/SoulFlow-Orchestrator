import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RegexEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "match");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.operation")}<span className="label__required">*</span></label>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["match", "match_all", "replace", "extract", "split", "test"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.field_flags")}</label>
          <input className="input input--sm" value={String(node.flags || "g")} onChange={(e) => update({ flags: e.target.value })} placeholder="g" />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_pattern")}</label>
        <input className="input" value={String(node.pattern || "")} onChange={(e) => update({ pattern: e.target.value })} placeholder="(\w+)@(\w+)" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.input_data")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="user@example.com" />
      </div>
      {op === "replace" && (
        <div className="builder-row">
          <label className="label">{t("workflows.replacement")}</label>
          <input className="input" value={String(node.replacement || "")} onChange={(e) => update({ replacement: e.target.value })} placeholder="$1 at $2" />
        </div>
      )}
    </>
  );
}

export const regex_descriptor: FrontendNodeDescriptor = {
  node_type: "regex",
  icon: "\u{1F50D}",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.regex.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.regex.output.result" },
    { name: "success", type: "boolean", description: "node.regex.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.regex.input.operation" },
    { name: "input",     type: "string", description: "node.regex.input.input" },
    { name: "pattern",   type: "string", description: "node.regex.input.pattern" },
  ],
  create_default: () => ({ operation: "match", input: "", pattern: "", flags: "g", replacement: "" }),
  EditPanel: RegexEditPanel,
};
