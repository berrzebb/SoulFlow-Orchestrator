import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ProcessEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "list");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.process_operation")}</label>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["list", "start", "stop", "info"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {op === "list" && (
        <div className="builder-row">
          <label className="label">{t("workflows.process_filter")}</label>
          <input className="input input--sm" value={String(node.filter || "")} onChange={(e) => update({ filter: e.target.value })} placeholder="node" />
        </div>
      )}
      {op === "start" && (
        <div className="builder-row">
          <label className="label">{t("workflows.shell_command")}</label>
          <input className="input" value={String(node.command || "")} onChange={(e) => update({ command: e.target.value })} placeholder="npm run start" />
        </div>
      )}
      {(op === "stop" || op === "info") && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.field_pid")}</label>
            <input className="input input--sm" type="number" min={1} value={String(node.pid ?? "")} onChange={(e) => update({ pid: Number(e.target.value) || 0 })} />
          </div>
          {op === "stop" && (
            <div className="builder-row">
              <label className="label">{t("workflows.signal")}</label>
              <select className="input input--sm" value={String(node.signal || "SIGTERM")} onChange={(e) => update({ signal: e.target.value })}>
                {["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export const process_descriptor: FrontendNodeDescriptor = {
  node_type: "process",
  icon: "\u{2699}",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.process.label",
  category: "integration",
  output_schema: [
    { name: "output",  type: "string",  description: "node.process.output.output" },
    { name: "success", type: "boolean", description: "node.process.output.success" },
    { name: "pid",     type: "number",  description: "node.process.output.pid" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.process.input.operation" },
    { name: "command",   type: "string", description: "node.process.input.command" },
    { name: "pid",       type: "number", description: "node.process.input.pid" },
  ],
  create_default: () => ({ operation: "list", command: "", pid: 0, signal: "SIGTERM", filter: "" }),
  EditPanel: ProcessEditPanel,
};
