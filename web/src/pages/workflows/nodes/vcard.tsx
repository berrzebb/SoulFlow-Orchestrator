import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const VCARD_ACTIONS = ["generate", "parse", "validate", "to_json", "from_json"] as const;

function VcardEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {VCARD_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {(action === "generate") && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.vcard_name")} required>
              <input className="input input--sm" value={String(node.name || "")} onChange={(e) => update({ name: e.target.value })} placeholder="Jane Doe" />
            </BuilderField>
            <BuilderField label={t("workflows.vcard_email")}>
              <input className="input input--sm" type="email" value={String(node.email || "")} onChange={(e) => update({ email: e.target.value })} placeholder="jane@example.com" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderRowPair>
            <BuilderField label={t("workflows.vcard_phone")}>
              <input className="input input--sm" value={String(node.phone || "")} onChange={(e) => update({ phone: e.target.value })} placeholder="+82-10-1234-5678" />
            </BuilderField>
            <BuilderField label={t("workflows.vcard_org")}>
              <input className="input input--sm" value={String(node.org || "")} onChange={(e) => update({ org: e.target.value })} placeholder="Acme Corp" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderRowPair>
            <BuilderField label={t("workflows.vcard_job_title")}>
              <input className="input input--sm" value={String(node.job_title || "")} onChange={(e) => update({ job_title: e.target.value })} placeholder="Software Engineer" />
            </BuilderField>
            <BuilderField label={t("workflows.vcard_version")}>
              <select className="input input--sm" value={String(node.version || "4.0")} onChange={(e) => update({ version: e.target.value })}>
                <option value="3.0">3.0</option>
                <option value="4.0">4.0</option>
              </select>
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.vcard_url")}>
            <input className="input input--sm" type="url" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com" />
          </BuilderField>
          <BuilderField label={t("workflows.vcard_address")}>
            <input className="input input--sm" value={String(node.address || "")} onChange={(e) => update({ address: e.target.value })} placeholder="123 Main St, Seoul" />
          </BuilderField>
          <BuilderField label={t("workflows.vcard_note")}>
            <input className="input input--sm" value={String(node.note || "")} onChange={(e) => update({ note: e.target.value })} placeholder={t("node.vcard.note_placeholder")} />
          </BuilderField>
        </>
      )}
      {(action === "parse" || action === "validate" || action === "to_json") && (
        <BuilderField label={t("workflows.vcard_input")} required>
          <textarea className="input code-textarea" rows={6} value={String(node.vcard || "")} onChange={(e) => update({ vcard: e.target.value })} placeholder={"BEGIN:VCARD\nVERSION:4.0\nFN:Jane Doe\nEMAIL:jane@example.com\nEND:VCARD"} />
        </BuilderField>
      )}
      {action === "from_json" && (
        <BuilderField label={t("workflows.vcard_json_data")} required hint={t("workflows.vcard_json_data_hint")}>
          <textarea className="input code-textarea" rows={5} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder={'{"name":"Jane Doe","email":"jane@example.com"}'} />
        </BuilderField>
      )}
    </>
  );
}

export const vcard_descriptor: FrontendNodeDescriptor = {
  node_type: "vcard",
  icon: "\u{1F4C7}",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.vcard.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string",  description: "node.vcard.output.result" },
    { name: "valid",  type: "boolean", description: "node.vcard.output.valid" },
    { name: "errors", type: "array",   description: "node.vcard.output.errors" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.vcard.input.action" },
    { name: "name",   type: "string", description: "node.vcard.input.name" },
    { name: "vcard",  type: "string", description: "node.vcard.input.vcard" },
  ],
  create_default: () => ({
    action: "generate", name: "", email: "", phone: "", org: "",
    job_title: "", url: "", address: "", note: "", vcard: "", data: "", version: "4.0",
  }),
  EditPanel: VcardEditPanel,
};
