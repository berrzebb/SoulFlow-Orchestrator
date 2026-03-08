import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function NetworkEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "ping");
  return (
    <>
      <BuilderField label={t("workflows.network_operation")}>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["ping", "dns", "port_check", "http_head", "netstat"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      {op !== "netstat" && (
        <BuilderField label={t("workflows.host")}>
          <input className="input" value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="example.com" />
        </BuilderField>
      )}
      {op === "port_check" && (
        <BuilderField label={t("workflows.port")} hint={t("workflows.network_port_hint")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? "")} onChange={(e) => update({ port: Number(e.target.value) || 0 })} />
        </BuilderField>
      )}
      {op === "ping" && (
        <BuilderField label={t("workflows.field_count")} hint={t("workflows.network_ping_count_hint")}>
          <input className="input input--sm" type="number" min={1} max={10} value={String(node.count ?? 3)} onChange={(e) => update({ count: Number(e.target.value) || 3 })} />
        </BuilderField>
      )}
    </>
  );
}

export const network_descriptor: FrontendNodeDescriptor = {
  node_type: "network",
  icon: "\u{1F310}",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.network.label",
  category: "integration",
  output_schema: [
    { name: "output",  type: "string",  description: "node.network.output.output" },
    { name: "success", type: "boolean", description: "node.network.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.network.input.operation" },
    { name: "host",      type: "string", description: "node.network.input.host" },
    { name: "port",      type: "number", description: "node.network.input.port" },
  ],
  create_default: () => ({ operation: "ping", host: "", port: 0, count: 3 }),
  EditPanel: NetworkEditPanel,
};
