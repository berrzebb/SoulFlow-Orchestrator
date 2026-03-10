import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["bind", "search", "info"];
const SCOPES = ["base", "one", "sub"];

function LdapEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "search");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.host")} required>
          <input className="input input--sm" required value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="ldap.example.com" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? 389)} onChange={(e) => update({ port: Number(e.target.value) || 389 })} />
        </BuilderField>
        <BuilderField label={t("workflows.ldap_bind_dn")}>
          <input className="input input--sm" value={String(node.bind_dn || "")} onChange={(e) => update({ bind_dn: e.target.value })} placeholder="cn=admin,dc=example,dc=com" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.password")}>
        <input className="input input--sm" type="password" value={String(node.password || "")} onChange={(e) => update({ password: e.target.value })} />
      </BuilderField>
      {action === "search" && (
        <>
          <BuilderField label={t("workflows.ldap_base_dn")} required>
            <input className="input input--sm" required value={String(node.base_dn || "")} onChange={(e) => update({ base_dn: e.target.value })} placeholder="dc=example,dc=com" aria-required="true" />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.field_filter")}>
              <input className="input input--sm" value={String(node.filter || "(objectClass=*)")} onChange={(e) => update({ filter: e.target.value })} placeholder="(objectClass=*)" />
            </BuilderField>
            <BuilderField label={t("workflows.field_scope")}>
              <select className="input input--sm" value={String(node.scope || "sub")} onChange={(e) => update({ scope: e.target.value })}>
                {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
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
    { name: "result", type: "object", description: "node.ldap.output.result" },
    { name: "success", type: "boolean", description: "node.ldap.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.ldap.input.action" },
    { name: "host", type: "string", description: "node.ldap.input.host" },
    { name: "base_dn", type: "string", description: "node.ldap.input.base_dn" },
  ],
  create_default: () => ({ action: "search", host: "", port: 389, bind_dn: "", password: "", base_dn: "", filter: "(objectClass=*)", scope: "sub" }),
  EditPanel: LdapEditPanel,
};
