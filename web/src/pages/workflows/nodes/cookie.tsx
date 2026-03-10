import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "serialize", "parse_set_cookie", "build_set_cookie", "validate", "jar_merge", "is_expired"];

function CookieEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      {(action === "parse" || action === "parse_set_cookie" || action === "is_expired" || action === "validate" || action === "jar_merge") && (
        <BuilderField label={t("workflows.cookie_string")} required>
          <input className="input input--sm" required value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="name=value; Path=/; Secure" aria-required="true" />
        </BuilderField>
      )}
      {(action === "serialize" || action === "build_set_cookie") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_name")} required>
            <input className="input input--sm" required value={String(node.cookie_name || "")} onChange={(e) => update({ cookie_name: e.target.value })} placeholder="session" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.field_value")} required>
            <input className="input input--sm" required value={String(node.cookie_value || "")} onChange={(e) => update({ cookie_value: e.target.value })} placeholder="abc123" aria-required="true" />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const cookie_descriptor: FrontendNodeDescriptor = {
  node_type: "cookie",
  icon: "🍪",
  color: "#8d6e63",
  shape: "rect",
  toolbar_label: "node.cookie.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.cookie.output.result" },
    { name: "success", type: "boolean", description: "node.cookie.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.cookie.input.action" },
    { name: "input", type: "string", description: "node.cookie.input.input" },
  ],
  create_default: () => ({ action: "parse", input: "", cookie_name: "", cookie_value: "" }),
  EditPanel: CookieEditPanel,
};
