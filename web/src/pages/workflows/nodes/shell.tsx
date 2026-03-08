import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ShellEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.shell_command")}>
        <textarea autoFocus className="input code-textarea" rows={3} value={String(node.command || "")} onChange={(e) => update({ command: e.target.value })} placeholder="echo Hello World" />
      </BuilderField>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.working_dir")}>
          <input className="input input--sm" value={String(node.working_dir || "")} onChange={(e) => update({ working_dir: e.target.value })} placeholder="(workspace default)" />
        </BuilderField>
        <BuilderField label={t("workflows.timeout_ms")} hint={t("workflows.timeout_ms_hint")}>
          <input className="input input--sm" type="number" min={1000} max={120000} step={1000} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 30000 })} />
        </BuilderField>
      </div>
    </>
  );
}

export const shell_descriptor: FrontendNodeDescriptor = {
  node_type: "shell",
  icon: "\u{1F4BB}",
  color: "#2d2d2d",
  shape: "rect",
  toolbar_label: "node.shell.label",
  category: "integration",
  output_schema: [
    { name: "stdout",    type: "string", description: "node.shell.output.stdout" },
    { name: "stderr",    type: "string", description: "node.shell.output.stderr" },
    { name: "exit_code", type: "number", description: "node.shell.output.exit_code" },
  ],
  input_schema: [
    { name: "command", type: "string", description: "node.shell.input.command" },
  ],
  create_default: () => ({ command: "", timeout_ms: 30000, working_dir: "" }),
  EditPanel: ShellEditPanel,
};
