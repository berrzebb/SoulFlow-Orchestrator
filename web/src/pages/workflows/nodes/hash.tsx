import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function HashEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.hash.input.action")}>
        <input autoFocus className="input input--sm" value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.hash.input.input")}>
        <input className="input input--sm" value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.hash.input.algorithm")}>
        <input className="input input--sm" value={String(node.algorithm || "")} onChange={(e) => update({ algorithm: e.target.value })} />
      </BuilderField>
    </>
  );
}

export const hash_descriptor: FrontendNodeDescriptor = {
  node_type: "hash",
  icon: "🔒",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.hash.label",
  category: "data",
  output_schema: [
    { name: "digest", type: "string", description: "node.hash.output.digest" },
    { name: "success", type: "boolean", description: "node.hash.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.hash.input.action" },
    { name: "input", type: "string", description: "node.hash.input.input" },
    { name: "algorithm", type: "string", description: "node.hash.input.algorithm" },
  ],
  create_default: () => ({ action: "", input: "", algorithm: "" }),
  EditPanel: HashEditPanel,
};
