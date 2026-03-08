import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DockerEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "ps");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.docker_operation")}<span className="label__required">*</span></label>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["ps", "run", "stop", "rm", "logs", "exec", "images", "inspect"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.container")}</label>
          <input className="input input--sm" value={String(node.container || "")} onChange={(e) => update({ container: e.target.value })} placeholder="container-name" />
        </div>
      </div>
      {op === "run" && (
        <div className="builder-row">
          <label className="label">{t("workflows.image")}</label>
          <input className="input" value={String(node.image || "")} onChange={(e) => update({ image: e.target.value })} placeholder="node:22-slim" />
        </div>
      )}
      {(op === "run" || op === "exec") && (
        <div className="builder-row">
          <label className="label">{t("workflows.shell_command")}</label>
          <input className="input" value={String(node.command || "")} onChange={(e) => update({ command: e.target.value })} placeholder="sh -c 'echo hello'" />
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.extra_args")}</label>
        <input className="input input--sm" value={String(node.args || "")} onChange={(e) => update({ args: e.target.value })} placeholder="--rm -e FOO=bar" />
      </div>
    </>
  );
}

export const docker_descriptor: FrontendNodeDescriptor = {
  node_type: "docker",
  icon: "\u{1F433}",
  color: "#2496ed",
  shape: "rect",
  toolbar_label: "node.docker.label",
  category: "integration",
  output_schema: [
    { name: "output",  type: "string",  description: "node.docker.output.output" },
    { name: "success", type: "boolean", description: "node.docker.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.docker.input.operation" },
    { name: "container", type: "string", description: "node.docker.input.container" },
    { name: "image",     type: "string", description: "node.docker.input.image" },
  ],
  create_default: () => ({ operation: "ps", container: "", image: "", command: "", args: "", tail: 50 }),
  EditPanel: DockerEditPanel,
};
