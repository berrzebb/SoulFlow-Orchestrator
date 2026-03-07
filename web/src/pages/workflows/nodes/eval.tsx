import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EvalEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.field_code")}</label>
        <textarea className="input code-textarea" rows={5} value={String(node.code || "")} onChange={(e) => update({ code: e.target.value })} placeholder="return x + y;" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_context_json")}</label>
        <textarea className="input code-textarea" rows={2} value={String(node.context || "")} onChange={(e) => update({ context: e.target.value })} placeholder='{"x": 1, "y": 2}' />
      </div>
    </>
  );
}

export const eval_descriptor: FrontendNodeDescriptor = {
  node_type: "eval",
  icon: "\u{1F4BB}",
  color: "#4a148c",
  shape: "rect",
  toolbar_label: "node.eval.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.eval.output.result" },
    { name: "success", type: "boolean", description: "node.eval.output.success" },
  ],
  input_schema: [
    { name: "code",    type: "string", description: "node.eval.input.code" },
    { name: "context", type: "string", description: "node.eval.input.context" },
  ],
  create_default: () => ({ code: "", context: "" }),
  EditPanel: EvalEditPanel,
};
