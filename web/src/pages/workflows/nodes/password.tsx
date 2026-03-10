import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["strength", "check_policy", "hash", "verify", "generate", "entropy"];

function PasswordEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "strength");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {action !== "generate" && (
        <BuilderField label={t("workflows.password")} required>
          <input className="input input--sm" type="password" required value={String(node.password_input || "")} onChange={(e) => update({ password_input: e.target.value })} aria-required="true" />
        </BuilderField>
      )}
      {action === "verify" && (
        <BuilderField label={t("workflows.field_hash")} required>
          <input className="input input--sm" required value={String(node.hash || "")} onChange={(e) => update({ hash: e.target.value })} placeholder="b0$..." aria-required="true" />
        </BuilderField>
      )}
      {action === "generate" && (
        <BuilderField label={t("workflows.field_length")}>
          <input className="input input--sm" type="number" min={8} max={128} value={String(node.length ?? 16)} onChange={(e) => update({ length: Number(e.target.value) || 16 })} />
        </BuilderField>
      )}
    </>
  );
}

export const password_descriptor: FrontendNodeDescriptor = {
  node_type: "password",
  icon: "🔑",
  color: "#c62828",
  shape: "rect",
  toolbar_label: "node.password.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.password.output.result" },
    { name: "success", type: "boolean", description: "node.password.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.password.input.action" },
    { name: "password_input", type: "string", description: "node.password.input.password_input" },
  ],
  create_default: () => ({ action: "strength", password_input: "", length: 16 }),
  EditPanel: PasswordEditPanel,
};
