import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function PkgManagerEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "list");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.pkg_manager")}>
          <select autoFocus className="input input--sm" value={String(node.manager || "npm")} onChange={(e) => update({ manager: e.target.value })}>
            {["npm", "pip", "cargo"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.pkg_operation")}>
          <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["list", "install", "uninstall", "audit", "outdated", "info"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      {["install", "uninstall", "info"].includes(op) && (
        <BuilderField label={t("workflows.package_name")}>
          <input className="input" value={String(node.package_name || "")} onChange={(e) => update({ package_name: e.target.value })} placeholder="lodash" />
        </BuilderField>
      )}
      <BuilderField label={t("workflows.extra_args")}>
        <input className="input input--sm" value={String(node.flags || "")} onChange={(e) => update({ flags: e.target.value })} placeholder="--save-dev" />
      </BuilderField>
    </>
  );
}

export const package_manager_descriptor: FrontendNodeDescriptor = {
  node_type: "package_manager",
  icon: "\u{1F4E6}",
  color: "#c62828",
  shape: "rect",
  toolbar_label: "node.package_manager.label",
  category: "integration",
  output_schema: [
    { name: "output",  type: "string",  description: "node.package_manager.output.output" },
    { name: "success", type: "boolean", description: "node.package_manager.output.success" },
  ],
  input_schema: [
    { name: "operation",    type: "string", description: "node.package_manager.input.operation" },
    { name: "manager",      type: "string", description: "node.package_manager.input.manager" },
    { name: "package_name", type: "string", description: "node.package_manager.input.package_name" },
  ],
  create_default: () => ({ operation: "list", manager: "npm", package_name: "", flags: "" }),
  EditPanel: PkgManagerEditPanel,
};
