import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function NetworkEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "ping");
  return (
    <>
      <BuilderField label={t("workflows.network_operation")}>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["ping", "dns", "whois", "port_check", "http_head", "netstat", "ip"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      {op !== "netstat" && op !== "ip" && (
        <BuilderField label={t("workflows.host")}>
          <input className="input" value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="example.com" />
        </BuilderField>
      )}
      {op === "ip" && (
        <>
          <BuilderField label={t("workflows.network_ip_action")}>
            <select className="input input--sm" value={String(node.ip_action || "parse")} onChange={(e) => update({ ip_action: e.target.value })}>
              {["parse", "validate", "cidr_contains", "subnet", "is_private", "is_v6", "range", "to_int", "from_int"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.network_ip")} required>
              <input className="input input--sm" value={String(node.ip || "")} onChange={(e) => update({ ip: e.target.value })} placeholder="192.168.1.1" />
            </BuilderField>
            <BuilderField label={t("workflows.network_cidr")}>
              <input className="input input--sm" value={String(node.cidr || "")} onChange={(e) => update({ cidr: e.target.value })} placeholder="192.168.1.0/24" />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
      {op === "dns" && (
        <BuilderField label={t("workflows.network_dns_record_type")}>
          <select className="input input--sm" value={String(node.dns_record_type || "lookup")} onChange={(e) => update({ dns_record_type: e.target.value })}>
            {["lookup", "mx", "txt", "ns", "cname", "srv", "reverse", "any"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
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
  create_default: () => ({ operation: "ping", host: "", port: 0, count: 3, dns_record_type: "lookup" }),
  EditPanel: NetworkEditPanel,
};
