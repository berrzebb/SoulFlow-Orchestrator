import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RateLimitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.rate_limit.description")}</label>
        <p className="builder-hint">{t("node.rate_limit.hint")}</p>
      </div>
    </>
  );
}

export const rate_limit_descriptor: FrontendNodeDescriptor = {
  node_type: "rate_limit",
  icon: "⏱",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.rate_limit.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.rate_limit.output.result" },
    { name: "success", type: "boolean", description: "node.rate_limit.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.rate_limit.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: RateLimitEditPanel,
};
