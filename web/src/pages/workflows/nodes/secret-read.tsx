import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SecretReadEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.secret_read.input.key")}>
        <input autoFocus className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.secret_read.input.namespace")}>
        <input className="input input--sm" value={String(node.namespace || "")} onChange={(e) => update({ namespace: e.target.value })} />
      </BuilderField>
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
