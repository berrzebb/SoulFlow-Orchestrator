import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function S3EditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.s3.description")}</label>
        <p className="builder-hint">{t("node.s3.hint")}</p>
      </div>
    </>
  );
}

export const s3_descriptor: FrontendNodeDescriptor = {
  node_type: "s3",
  icon: "📦",
  color: "#ff9900",
  shape: "rect",
  toolbar_label: "node.s3.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.s3.output.result" },
    { name: "success", type: "boolean", description: "node.s3.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.s3.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: S3EditPanel,
};
