import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CryptoEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.crypto.input.action")}>
        <input autoFocus className="input input--sm" value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.crypto.input.input")}>
        <input className="input input--sm" value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.crypto.input.key")}>
        <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} />
      </BuilderField>
    </>
  );
}

export const crypto_descriptor: FrontendNodeDescriptor = {
  node_type: "crypto",
  icon: "🔐",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.crypto.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.crypto.output.result" },
    { name: "success", type: "boolean", description: "node.crypto.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.crypto.input.action" },
    { name: "input", type: "string", description: "node.crypto.input.input" },
    { name: "key", type: "string", description: "node.crypto.input.key" },
  ],
  create_default: () => ({ action: "", input: "", key: "" }),
  EditPanel: CryptoEditPanel,
};
