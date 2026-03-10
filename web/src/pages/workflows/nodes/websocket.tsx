import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["connect", "send", "receive", "close", "list"];

function WebsocketEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "connect");
  return (
    <>
      {action === "connect" ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.field_url")} required>
            <input className="input input--sm" required value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="wss://example.com/ws" aria-required="true" />
          </BuilderField>
        </BuilderRowPair>
      ) : action !== "list" ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.websocket_connection_id")} required>
            <input className="input input--sm" required value={String(node.id || "")} onChange={(e) => update({ id: e.target.value })} placeholder="conn-1" aria-required="true" />
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      )}
      {action === "send" && (
        <BuilderField label={t("workflows.field_message")} required>
          <input className="input input--sm" required value={String(node.message || "")} onChange={(e) => update({ message: e.target.value })} aria-required="true" />
        </BuilderField>
      )}
      {action === "receive" && (
        <BuilderField label={t("workflows.timeout_ms")}>
          <input className="input input--sm" type="number" min={100} value={String(node.timeout_ms ?? 5000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 5000 })} />
        </BuilderField>
      )}
    </>
  );
}

export const websocket_descriptor: FrontendNodeDescriptor = {
  node_type: "websocket",
  icon: "🔌",
  color: "#ff9800",
  shape: "rect",
  toolbar_label: "node.websocket.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.websocket.output.result" },
    { name: "success", type: "boolean", description: "node.websocket.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.websocket.input.action" },
    { name: "url", type: "string", description: "node.websocket.input.url" },
    { name: "message", type: "string", description: "node.websocket.input.message" },
  ],
  create_default: () => ({ action: "connect", url: "", id: "", message: "", timeout_ms: 5000 }),
  EditPanel: WebsocketEditPanel,
};
