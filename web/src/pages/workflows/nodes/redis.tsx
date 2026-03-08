import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function RedisEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.redis.description")}</label>
        <p className="builder-hint">{t("node.redis.hint")}</p>
      </div>
    </>
  );
}

export const redis_descriptor: FrontendNodeDescriptor = {
  node_type: "redis",
  icon: "🔴",
  color: "#dc382d",
  shape: "rect",
  toolbar_label: "node.redis.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.redis.output.result" },
    { name: "success", type: "boolean", description: "node.redis.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.redis.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: RedisEditPanel,
};
