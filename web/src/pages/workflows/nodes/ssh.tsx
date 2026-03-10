import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["exec", "scp_upload", "scp_download", "info"];

function SshEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "exec");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.host")} required>
          <input className="input input--sm" required value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="user@192.168.1.1" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? 22)} onChange={(e) => update({ port: Number(e.target.value) || 22 })} />
        </BuilderField>
        <BuilderField label={t("workflows.ssh_identity_file")}>
          <input className="input input--sm" value={String(node.identity_file || "")} onChange={(e) => update({ identity_file: e.target.value })} placeholder="/path/to/key" />
        </BuilderField>
      </BuilderRowPair>
      {action === "exec" && (
        <BuilderField label={t("workflows.field_command")} required>
          <input className="input input--sm" required value={String(node.command || "")} onChange={(e) => update({ command: e.target.value })} placeholder="ls -la" aria-required="true" />
        </BuilderField>
      )}
      {(action === "scp_upload" || action === "scp_download") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.ssh_local_path")} required>
            <input className="input input--sm" required value={String(node.local_path || "")} onChange={(e) => update({ local_path: e.target.value })} placeholder="/local/file.txt" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.ssh_remote_path")} required>
            <input className="input input--sm" required value={String(node.remote_path || "")} onChange={(e) => update({ remote_path: e.target.value })} placeholder="/remote/file.txt" aria-required="true" />
          </BuilderField>
        </BuilderRowPair>
      )}
      <BuilderField label={t("workflows.timeout_ms")} hint={t("workflows.timeout_ms_hint")}>
        <input className="input input--sm" type="number" min={1000} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 30000 })} />
      </BuilderField>
    </>
  );
}

export const ssh_descriptor: FrontendNodeDescriptor = {
  node_type: "ssh",
  icon: "🖥️",
  color: "#37474f",
  shape: "rect",
  toolbar_label: "node.ssh.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.ssh.output.result" },
    { name: "success", type: "boolean", description: "node.ssh.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.ssh.input.action" },
    { name: "host", type: "string", description: "node.ssh.input.host" },
    { name: "command", type: "string", description: "node.ssh.input.command" },
  ],
  create_default: () => ({ action: "exec", host: "", port: 22, identity_file: "", command: "", timeout_ms: 30000 }),
  EditPanel: SshEditPanel,
};
