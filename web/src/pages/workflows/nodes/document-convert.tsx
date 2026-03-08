import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DocumentConvertEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.document_convert.input.input")}</label>
        <input className="input input--sm" value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.document_convert.input.to")}</label>
        <input className="input input--sm" value={String(node.to || "")} onChange={(e) => update({ to: e.target.value })} />
      </div>
    </>
  );
}

export const document_convert_descriptor: FrontendNodeDescriptor = {
  node_type: "document_convert",
  icon: "🔄",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.document_convert.label",
  category: "data",
  output_schema: [
    { name: "output", type: "string", description: "node.document_convert.output.output" },
    { name: "success", type: "boolean", description: "node.document_convert.output.success" },
  ],
  input_schema: [
    { name: "input", type: "string", description: "node.document_convert.input.input" },
    { name: "to", type: "string", description: "node.document_convert.input.to" },
  ],
  create_default: () => ({ input: "", to: "" }),
  EditPanel: DocumentConvertEditPanel,
};
