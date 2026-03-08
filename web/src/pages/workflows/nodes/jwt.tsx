import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function JwtEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("node.jwt.input.action")}>
        <input autoFocus className="input input--sm" value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.jwt.input.token")}>
        <input className="input input--sm" value={String(node.token || "")} onChange={(e) => update({ token: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("node.jwt.input.secret")}>
        <input className="input input--sm" value={String(node.secret || "")} onChange={(e) => update({ secret: e.target.value })} />
      </BuilderField>
    </>
  );
}

export const jwt_descriptor: FrontendNodeDescriptor = {
  node_type: "jwt",
  icon: "🎫",
  color: "#ff6f00",
  shape: "rect",
  toolbar_label: "node.jwt.label",
  category: "data",
  output_schema: [
    { name: "token", type: "string", description: "node.jwt.output.token" },
    { name: "payload", type: "string", description: "node.jwt.output.payload" },
    { name: "valid", type: "boolean", description: "node.jwt.output.valid" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.jwt.input.action" },
    { name: "token", type: "string", description: "node.jwt.input.token" },
    { name: "secret", type: "string", description: "node.jwt.input.secret" },
  ],
  create_default: () => ({ action: "", token: "", secret: "" }),
  EditPanel: JwtEditPanel,
};
