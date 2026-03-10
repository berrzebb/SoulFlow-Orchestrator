import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["list", "upload", "download", "mkdir", "delete", "info"];

function FtpEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "list");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.host")} required>
          <input className="input input--sm" required value={String(node.host || "")} onChange={(e) => update({ host: e.target.value })} placeholder="ftp.example.com" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? 21)} onChange={(e) => update({ port: Number(e.target.value) || 21 })} />
        </BuilderField>
        <BuilderField label={t("workflows.username")}>
          <input className="input input--sm" value={String(node.username || "anonymous")} onChange={(e) => update({ username: e.target.value })} placeholder="anonymous" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.password")}>
        <input className="input input--sm" type="password" value={String(node.password || "")} onChange={(e) => update({ password: e.target.value })} />
      </BuilderField>
      <BuilderField label={t("workflows.remote_path")} required>
        <input className="input input--sm" required value={String(node.remote_path || "/")} onChange={(e) => update({ remote_path: e.target.value })} placeholder="/" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const ftp_descriptor: FrontendNodeDescriptor = {
  node_type: "ftp",
  icon: "📤",
  color: "#3f51b5",
  shape: "rect",
  toolbar_label: "node.ftp.label",
  category: "integration",
  output_schema: [
    { name: "result",  type: "object",  description: "node.ftp.output.result" },
    { name: "success", type: "boolean", description: "node.ftp.output.success" },
  ],
  input_schema: [
    { name: "action",      type: "string", description: "node.ftp.input.action" },
    { name: "host",        type: "string", description: "node.ftp.input.host" },
    { name: "remote_path", type: "string", description: "node.ftp.input.remote_path" },
  ],
  create_default: () => ({ action: "list", host: "", port: 21, username: "anonymous", password: "", remote_path: "/" }),
  EditPanel: FtpEditPanel,
};
