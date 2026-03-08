import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RssEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.rss.description")}</label>
        <p className="builder-hint">{t("node.rss.hint")}</p>
      </div>
    </>
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
