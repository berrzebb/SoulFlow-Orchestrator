import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EmailEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.email.input.action")}<span className="label__required">*</span></label>
        <input autoFocus className="input input--sm" required value={String(node.action || "")} onChange={(e) => update({ action: e.target.value })} placeholder="send, draft" aria-label={t("node.email.input.action")} aria-required="true" />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.email.input.to")}<span className="label__required">*</span></label>
        <input className="input input--sm" required value={String(node.to || "")} onChange={(e) => update({ to: e.target.value })} placeholder="user@example.com" aria-label={t("node.email.input.to")} aria-required="true" />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.email.input.subject")}<span className="label__required">*</span></label>
        <input className="input input--sm" required value={String(node.subject || "")} onChange={(e) => update({ subject: e.target.value })} placeholder="Email subject {{memory.var}}" aria-label={t("node.email.input.subject")} aria-required="true" />
      </div>
      <div className="builder-row">
        <label className="label">{t("node.email.input.body")}<span className="label__required">*</span></label>
        <input className="input input--sm" required value={String(node.body || "")} onChange={(e) => update({ body: e.target.value })} placeholder="Email body with {{memory.var}} templates" aria-label={t("node.email.input.body")} aria-required="true" />
      </div>
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
  create_default: () => ({ action: "", to: "", subject: "", body: "" }),
  EditPanel: EmailEditPanel,
};
