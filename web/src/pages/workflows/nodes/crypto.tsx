import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CryptoEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.crypto.input.action")}</label>
        <input className="input input--sm" value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.crypto.input.input")}</label>
        <input className="input input--sm" value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.crypto.input.key")}</label>
        <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} />
      </div>
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
