import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ShellEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.shell_command")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.command || "")} onChange={(e) => update({ command: e.target.value })} placeholder="echo Hello World" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.working_dir")}</label>
          <input className="input input--sm" value={String(node.working_dir || "")} onChange={(e) => update({ working_dir: e.target.value })} placeholder="(workspace default)" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.timeout_ms")}</label>
          <input className="input input--sm" type="number" min={1000} max={120000} step={1000} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 30000 })} />
        </div>
      </div>
    </>
  );
}

export const shell_descriptor: FrontendNodeDescriptor = {
  node_type: "shell",
  icon: "\u{1F4BB}",
  color: "#2d2d2d",
  shape: "rect",
  toolbar_label: "+ Shell",
  category: "integration",
  output_schema: [
    { name: "stdout",    type: "string", description: "Command stdout" },
    { name: "stderr",    type: "string", description: "Command stderr" },
    { name: "exit_code", type: "number", description: "Exit code" },
  ],
  input_schema: [
    { name: "command", type: "string", description: "Shell command" },
  ],
  create_default: () => ({ command: "", timeout_ms: 30000, working_dir: "" }),
  EditPanel: ShellEditPanel,
};
