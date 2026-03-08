import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LogParserEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.log_parser.description")} hint={t("node.log_parser.hint")}>
      {null}
    </BuilderField>
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
