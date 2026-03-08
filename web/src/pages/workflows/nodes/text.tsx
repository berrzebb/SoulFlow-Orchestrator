import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TextEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "count");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["upper", "lower", "title", "camel", "snake", "kebab", "slugify", "truncate", "pad", "count", "dedup", "similarity", "reverse", "join", "wrap", "trim_lines"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.input_data")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="Hello World" />
      </div>
      {op === "similarity" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_input_2")}</label>
          <input className="input" value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder="Hello Word" />
        </div>
      )}
      {op === "truncate" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_max_length")}</label>
          <input className="input input--sm" type="number" min={1} value={String(node.max_length ?? 100)} onChange={(e) => update({ max_length: Number(e.target.value) })} />
        </div>
      )}
      {op === "wrap" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_width")}</label>
          <input className="input input--sm" type="number" min={10} max={200} value={String(node.width ?? 80)} onChange={(e) => update({ width: Number(e.target.value) })} />
        </div>
      )}
    </>
  );
}

export const text_descriptor: FrontendNodeDescriptor = {
  node_type: "text",
  icon: "\u{1F520}",
  color: "#4e342e",
  shape: "rect",
  toolbar_label: "node.text.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.text.output.result" },
    { name: "success", type: "boolean", description: "node.text.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.text.input.operation" },
    { name: "input",     type: "string", description: "node.text.input.input" },
  ],
  create_default: () => ({ operation: "count", input: "", input2: "", max_length: 100, width: 80 }),
  EditPanel: TextEditPanel,
};
