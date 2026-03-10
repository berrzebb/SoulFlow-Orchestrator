import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function TextEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "count");
  return (
    <>
      <BuilderField label={t("workflows.operation")}>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["upper", "lower", "title", "camel", "snake", "kebab", "slugify", "filename_safe", "transliterate", "truncate", "pad", "count", "dedup", "similarity", "reverse", "join", "wrap", "trim_lines"].map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="Hello World" />
      </BuilderField>
      {op === "similarity" && (
        <BuilderField label={t("workflows.field_input_2")}>
          <input className="input" value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder="Hello Word" />
        </BuilderField>
      )}
      {op === "truncate" && (
        <BuilderField label={t("workflows.field_max_length")}>
          <input className="input input--sm" type="number" min={1} value={String(node.max_length ?? 100)} onChange={(e) => update({ max_length: Number(e.target.value) })} />
        </BuilderField>
      )}
      {op === "wrap" && (
        <BuilderField label={t("workflows.field_width")}>
          <input className="input input--sm" type="number" min={10} max={200} value={String(node.width ?? 80)} onChange={(e) => update({ width: Number(e.target.value) })} />
        </BuilderField>
      )}
      {op === "pad" && (
        <>
          <BuilderField label={t("workflows.text_pad_length")}>
            <input className="input input--sm" type="number" min={1} value={String(node.pad_length ?? 20)} onChange={(e) => update({ pad_length: Number(e.target.value) || 20 })} />
          </BuilderField>
          <BuilderField label={t("workflows.text_pad_side")}>
            <select className="input input--sm" value={String(node.pad_side || "right")} onChange={(e) => update({ pad_side: e.target.value })}>
              <option value="right">right</option>
              <option value="left">left</option>
              <option value="both">both</option>
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.text_pad_char")}>
            <input className="input input--sm" value={String(node.pad_char || " ")} onChange={(e) => update({ pad_char: e.target.value || " " })} placeholder=" " />
          </BuilderField>
        </>
      )}
      {op === "join" && (
        <BuilderField label={t("workflows.field_separator")}>
          <input className="input input--sm" value={String(node.separator ?? "\n")} onChange={(e) => update({ separator: e.target.value })} placeholder="\n" />
        </BuilderField>
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
  create_default: () => ({ operation: "count", input: "", input2: "", max_length: 100, width: 80, pad_length: 20, pad_side: "right", pad_char: " ", separator: "\n" }),
  EditPanel: TextEditPanel,
};
