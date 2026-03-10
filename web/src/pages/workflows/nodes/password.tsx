import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["strength", "check_policy", "hash", "verify", "generate", "entropy"];
const HASH_ALGOS = ["bcrypt", "argon2", "sha256", "md5"];

function PasswordEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "strength");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {(action === "hash" || action === "verify") && (
          <BuilderField label={t("workflows.field_algorithm")}>
            <select className="input input--sm" value={String(node.algorithm || "bcrypt")} onChange={(e) => update({ algorithm: e.target.value })}>
              {HASH_ALGOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      {action !== "generate" && (
        <BuilderField label={t("workflows.password")} required>
          <input className="input input--sm" type="password" required value={String(node.password || "")} onChange={(e) => update({ password: e.target.value })} aria-required="true" />
        </BuilderField>
      )}
      {action === "verify" && (
        <BuilderField label={t("workflows.field_hash")} required>
          <input className="input input--sm" required value={String(node.hash || "")} onChange={(e) => update({ hash: e.target.value })} placeholder="b0$..." aria-required="true" />
        </BuilderField>
      )}
      {action === "generate" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_length")}>
            <input className="input input--sm" type="number" min={8} max={128} value={String(node.length ?? 16)} onChange={(e) => update({ length: Number(e.target.value) || 16 })} />
          </BuilderField>
        </BuilderRowPair>
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
    { name: "password", type: "string", description: "node.password.input.password" },
  ],
  create_default: () => ({ action: "strength", password: "", algorithm: "bcrypt", length: 16 }),
  EditPanel: PasswordEditPanel,
};
