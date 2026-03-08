import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LogParserEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.log_parser.description")}</label>
        <p className="builder-hint">{t("node.log_parser.hint")}</p>
      </div>
    </>
  );
}

export const log_parser_descriptor: FrontendNodeDescriptor = {
  node_type: "log_parser",
  icon: "📜",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.log_parser.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.log_parser.output.result" },
    { name: "success", type: "boolean", description: "node.log_parser.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.log_parser.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: LogParserEditPanel,
};
