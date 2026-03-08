import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function LdapEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.ldap.description")}</label>
        <p className="builder-hint">{t("node.ldap.hint")}</p>
      </div>
    </>
  );
}

export const ldap_descriptor: FrontendNodeDescriptor = {
  node_type: "ldap",
  icon: "📂",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.ldap.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.ldap.output.result" },
    { name: "success", type: "boolean", description: "node.ldap.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.ldap.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: LdapEditPanel,
};
