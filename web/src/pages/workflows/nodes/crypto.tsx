import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["encrypt", "decrypt", "sign", "verify", "generate_key"];

function CryptoEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "encrypt");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {action === "generate_key" ? (
        String(node.key_type || "aes") === "rsa" ? (
          <BuilderRowPair>
            <BuilderField label={t("workflows.crypto_key_type")}>
              <select className="input input--sm" value={String(node.key_type || "aes")} onChange={(e) => update({ key_type: e.target.value })}>
                <option value="aes">aes</option>
                <option value="rsa">rsa</option>
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.crypto_key_size")}>
              <select className="input input--sm" value={String(node.key_size || 2048)} onChange={(e) => update({ key_size: Number(e.target.value) })}>
                <option value="2048">2048</option>
                <option value="4096">4096</option>
              </select>
            </BuilderField>
          </BuilderRowPair>
        ) : (
          <BuilderField label={t("workflows.crypto_key_type")}>
            <select className="input input--sm" value={String(node.key_type || "aes")} onChange={(e) => update({ key_type: e.target.value })}>
              <option value="aes">aes</option>
              <option value="rsa">rsa</option>
            </select>
          </BuilderField>
        )
      ) : (
        <>
          <BuilderField label={t("workflows.field_input")} required>
            <textarea className="input" required rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={action === "decrypt" ? "Ciphertext (hex)" : "Plaintext"} aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.field_key")} required>
            <textarea className="input" required rows={2} value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder={action === "sign" || action === "verify" ? "PEM key" : "64 hex chars (AES-256)"} aria-required="true" />
          </BuilderField>
          {action === "decrypt" && (
            <BuilderRowPair>
              <BuilderField label={t("workflows.crypto_iv")} required>
                <input className="input input--sm" required value={String(node.iv || "")} onChange={(e) => update({ iv: e.target.value })} aria-required="true" />
              </BuilderField>
              <BuilderField label={t("workflows.crypto_auth_tag")} required>
                <input className="input input--sm" required value={String(node.auth_tag || "")} onChange={(e) => update({ auth_tag: e.target.value })} aria-required="true" />
              </BuilderField>
            </BuilderRowPair>
          )}
          {action === "verify" && (
            <BuilderField label={t("workflows.crypto_signature")} required>
              <input className="input input--sm" required value={String(node.signature || "")} onChange={(e) => update({ signature: e.target.value })} aria-required="true" />
            </BuilderField>
          )}
        </>
      )}
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
  create_default: () => ({ action: "encrypt", input: "", key: "", key_type: "aes", key_size: 2048, iv: "", auth_tag: "", signature: "" }),
  EditPanel: CryptoEditPanel,
};
