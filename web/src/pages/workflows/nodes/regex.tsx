import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function RegexEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "match");
  return (
    <>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["match", "match_all", "replace", "extract", "split", "test"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_flags")}>
          <input className="input input--sm" value={String(node.flags || "g")} onChange={(e) => update({ flags: e.target.value })} placeholder="g" />
        </BuilderField>
      </div>
      <BuilderField label={t("workflows.field_pattern")}>
        <input className="input" value={String(node.pattern || "")} onChange={(e) => update({ pattern: e.target.value })} placeholder="(\w+)@(\w+)" />
      </BuilderField>
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="user@example.com" />
      </BuilderField>
      {op === "replace" && (
        <BuilderField label={t("workflows.replacement")}>
          <input className="input" value={String(node.replacement || "")} onChange={(e) => update({ replacement: e.target.value })} placeholder="$1 at $2" />
        </BuilderField>
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
