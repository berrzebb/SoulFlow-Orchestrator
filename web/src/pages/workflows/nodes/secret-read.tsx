import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SecretReadEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.secret_read.input.key")}</label>
        <input autoFocus className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.secret_read.input.namespace")}</label>
        <input className="input input--sm" value={String(node.namespace || "")} onChange={(e) => update({ namespace: e.target.value })} />
      </div>
    </>
  );
}

export const secret_read_descriptor: FrontendNodeDescriptor = {
  node_type: "secret_read",
  icon: "🔑",
  color: "#d84315",
  shape: "rect",
  toolbar_label: "node.secret_read.label",
  category: "data",
  output_schema: [
    { name: "value", type: "string", description: "node.secret_read.output.value" },
    { name: "success", type: "boolean", description: "node.secret_read.output.success" },
  ],
  input_schema: [
    { name: "key", type: "string", description: "node.secret_read.input.key" },
    { name: "namespace", type: "string", description: "node.secret_read.input.namespace" },
  ],
  create_default: () => ({ key: "", namespace: "" }),
  EditPanel: SecretReadEditPanel,
};
