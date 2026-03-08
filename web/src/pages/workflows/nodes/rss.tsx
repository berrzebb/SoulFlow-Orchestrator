import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RssEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.rss.description")} hint={t("node.rss.hint")}>
      {null}
    </BuilderField>
  );
}

export const rss_descriptor: FrontendNodeDescriptor = {
  node_type: "rss",
  icon: "📡",
  color: "#ee802f",
  shape: "rect",
  toolbar_label: "node.rss.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.rss.output.result" },
    { name: "success", type: "boolean", description: "node.rss.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.rss.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: RssEditPanel,
};
