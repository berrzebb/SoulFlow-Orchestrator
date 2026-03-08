import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function GitEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.git_operation")} required>
          <select autoFocus className="input input--sm" value={String(node.operation || "status")} onChange={(e) => update({ operation: e.target.value })}>
            {["status", "diff", "log", "commit", "push", "pull", "branch", "checkout", "stash", "tag"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.git_args")}>
          <input className="input input--sm" value={String(node.args || "")} onChange={(e) => update({ args: e.target.value })} placeholder="--oneline -5" />
        </BuilderField>
      </div>
      <BuilderField label={t("workflows.working_dir")}>
        <input className="input input--sm" value={String(node.working_dir || "")} onChange={(e) => update({ working_dir: e.target.value })} placeholder="(workspace default)" />
      </BuilderField>
    </>
  );
}

export const git_descriptor: FrontendNodeDescriptor = {
  node_type: "git",
  icon: "\u{1F500}",
  color: "#f05032",
  shape: "rect",
  toolbar_label: "node.git.label",
  category: "integration",
  output_schema: [
    { name: "stdout",    type: "string", description: "node.git.output.stdout" },
    { name: "exit_code", type: "number", description: "node.git.output.exit_code" },
    { name: "error",     type: "string", description: "node.git.output.error" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.git.input.operation" },
    { name: "args",      type: "string", description: "node.git.input.args" },
  ],
  create_default: () => ({ operation: "status", args: "", working_dir: "" }),
  EditPanel: GitEditPanel,
};
