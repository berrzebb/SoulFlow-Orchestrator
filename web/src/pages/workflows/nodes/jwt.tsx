import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["create", "verify", "decode"];
const ALGORITHMS = ["HS256", "HS384", "HS512"];

function JwtEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "create");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {action !== "decode" && (
          <BuilderField label={t("workflows.field_algorithm")}>
            <select className="input input--sm" value={String(node.algorithm || "HS256")} onChange={(e) => update({ algorithm: e.target.value })}>
              {ALGORITHMS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      {action === "create" ? (
        <>
          <BuilderField label={t("workflows.jwt_payload_json")} required>
            <textarea className="input" required rows={3} value={String(node.payload || "")} onChange={(e) => update({ payload: e.target.value })} placeholder='{"sub": "user123"}' aria-required="true" />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.field_secret")} required>
              <input className="input input--sm" required type="password" value={String(node.secret || "")} onChange={(e) => update({ secret: e.target.value })} aria-required="true" />
            </BuilderField>
            <BuilderField label={t("workflows.jwt_expires_in")}>
              <input className="input input--sm" value={String(node.expires_in || "")} onChange={(e) => update({ expires_in: e.target.value })} placeholder="1h / 30m / 7d" />
            </BuilderField>
          </BuilderRowPair>
        </>
      ) : (
        <>
          <BuilderField label={t("workflows.field_token")} required>
            <textarea className="input" required rows={3} value={String(node.token || "")} onChange={(e) => update({ token: e.target.value })} placeholder="eyJ..." aria-required="true" />
          </BuilderField>
          {action === "verify" && (
            <BuilderField label={t("workflows.field_secret")} required>
              <input className="input input--sm" required type="password" value={String(node.secret || "")} onChange={(e) => update({ secret: e.target.value })} aria-required="true" />
            </BuilderField>
          )}
        </>
      )}
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
  create_default: () => ({ action: "create", payload: "", secret: "", token: "", algorithm: "HS256" }),
  EditPanel: JwtEditPanel,
};
