import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DiffEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "compare");
  return (
    <>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.operation")}>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["compare", "patch", "stats"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_context_lines")} hint={t("workflows.diff_context_lines_hint")}>
          <input className="input input--sm" type="number" min={0} max={20} value={String(node.context_lines ?? 3)} onChange={(e) => update({ context_lines: Number(e.target.value) || 3 })} />
        </BuilderField>
      </div>
      {(op === "compare" || op === "stats") && (
        <>
          <BuilderField label={t("workflows.field_old_text")}>
            <textarea className="input code-textarea" rows={4} value={String(node.old_text || "")} onChange={(e) => update({ old_text: e.target.value })} placeholder="Original text or @file:path" />
          </BuilderField>
          <BuilderField label={t("workflows.field_new_text")}>
            <textarea className="input code-textarea" rows={4} value={String(node.new_text || "")} onChange={(e) => update({ new_text: e.target.value })} placeholder="Modified text or @file:path" />
          </BuilderField>
        </>
      )}
      {op === "patch" && (
        <BuilderField label={t("workflows.field_diff_text")}>
          <textarea className="input code-textarea" rows={6} value={String(node.diff_text || "")} onChange={(e) => update({ diff_text: e.target.value })} placeholder="Unified diff..." />
        </BuilderField>
      )}
    </>
  );
}

export const diff_descriptor: FrontendNodeDescriptor = {
  node_type: "diff",
  icon: "\u{1F4CB}",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.diff.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.diff.output.result" },
    { name: "success", type: "boolean", description: "node.diff.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.diff.input.operation" },
    { name: "old_text",  type: "string", description: "node.diff.input.old_text" },
    { name: "new_text",  type: "string", description: "node.diff.input.new_text" },
  ],
  create_default: () => ({ operation: "compare", old_text: "", new_text: "", diff_text: "", context_lines: 3 }),
  EditPanel: DiffEditPanel,
};
