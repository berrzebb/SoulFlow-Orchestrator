import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EmailEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("node.email.input.to")} required>
          <input autoFocus className="input input--sm" required value={String(node.to || "")} onChange={(e) => update({ to: e.target.value })} placeholder="user@example.com" aria-required="true" />
        </BuilderField>
        <BuilderField label={t("workflows.field_from")}>
          <input className="input input--sm" value={String(node.from || "")} onChange={(e) => update({ from: e.target.value })} placeholder="sender@example.com" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("node.email.input.subject")} required>
        <input className="input input--sm" required value={String(node.subject || "")} onChange={(e) => update({ subject: e.target.value })} placeholder="Email subject" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("node.email.input.body")} required>
        <textarea className="input input--sm" required rows={4} value={String(node.body || "")} onChange={(e) => update({ body: e.target.value })} placeholder="Email body with {{memory.var}} templates" aria-required="true" />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.smtp_host")} required>
          <input className="input input--sm" required value={String(node.smtp_host || "")} onChange={(e) => update({ smtp_host: e.target.value })} placeholder="smtp.example.com" aria-required="true" />
        </BuilderField>
        <BuilderField label={t("workflows.smtp_port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.smtp_port ?? 587)} onChange={(e) => update({ smtp_port: Number(e.target.value) || 587 })} />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.smtp_user")}>
          <input className="input input--sm" value={String(node.smtp_user || "")} onChange={(e) => update({ smtp_user: e.target.value })} />
        </BuilderField>
        <BuilderField label={t("workflows.smtp_password")}>
          <input className="input input--sm" type="password" value={String(node.smtp_pass || "")} onChange={(e) => update({ smtp_pass: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const email_descriptor: FrontendNodeDescriptor = {
  node_type: "email",
  icon: "✉",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.email.label",
  category: "integration",
  output_schema: [
    { name: "message_id", type: "string", description: "node.email.output.message_id" },
    { name: "success", type: "boolean", description: "node.email.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.email.input.action" },
    { name: "to", type: "string", description: "node.email.input.to" },
    { name: "subject", type: "string", description: "node.email.input.subject" },
    { name: "body", type: "string", description: "node.email.input.body" },
  ],
  create_default: () => ({ action: "send", to: "", from: "", subject: "", body: "", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "" }),
  EditPanel: EmailEditPanel,
};
