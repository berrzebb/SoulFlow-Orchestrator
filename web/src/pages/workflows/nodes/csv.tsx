import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CsvEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.csv.description")}</label>
        <p className="builder-hint">{t("node.csv.hint")}</p>
      </div>
    </>
  );
}

export const csv_descriptor: FrontendNodeDescriptor = {
  node_type: "csv",
  icon: "📊",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "node.csv.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.csv.output.result" },
    { name: "success", type: "boolean", description: "node.csv.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.csv.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: CsvEditPanel,
};
