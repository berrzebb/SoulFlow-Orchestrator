import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const DEP_OPS = ["parse_deps", "parse_reqs", "dep_tree", "circular_deps", "dep_stats", "dep_compare"];
const PKG_OPS = ["list", "install", "uninstall", "audit", "outdated", "info"];

function PkgManagerEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "list");
  const is_dep = DEP_OPS.includes(op);
  return (
    <>
      <BuilderField label={t("workflows.pkg_operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          <optgroup label={t("workflows.pkg_group_manager")}>{PKG_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}</optgroup>
          <optgroup label={t("workflows.pkg_group_dependency")}>{DEP_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}</optgroup>
        </select>
      </BuilderField>
      {!is_dep && (
        <>
          <BuilderField label={t("workflows.pkg_manager")}>
            <select className="input input--sm" value={String(node.manager || "npm")} onChange={(e) => update({ manager: e.target.value })}>
              {["npm", "pip", "cargo"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </BuilderField>
          {["install", "uninstall", "info"].includes(op) && (
            <BuilderField label={t("workflows.package_name")}>
              <input className="input" value={String(node.package_name || "")} onChange={(e) => update({ package_name: e.target.value })} placeholder="lodash" />
            </BuilderField>
          )}
          <BuilderField label={t("workflows.extra_args")}>
            <input className="input input--sm" value={String(node.flags || "")} onChange={(e) => update({ flags: e.target.value })} placeholder="--save-dev" />
          </BuilderField>
        </>
      )}
      {is_dep && (
        <>
          {op !== "dep_tree" && op !== "circular_deps" && (
            <BuilderField label={t("workflows.dep_input")} required hint={op === "dep_compare" ? t("workflows.dep_input_hint_compare") : op === "parse_reqs" ? t("workflows.dep_reqs_hint") : t("workflows.dep_input_hint")}>
              <textarea className="input" rows={4} value={String(node.dep_input || "")} onChange={(e) => update({ dep_input: e.target.value })} placeholder={op === "parse_reqs" ? "requests>=2.0\nnumpy==1.24.0" : '{"name":"app","dependencies":{"lodash":"^4.0.0"}}'} />
            </BuilderField>
          )}
          {op === "dep_compare" && (
            <BuilderField label={t("workflows.dep_input2")} required>
              <textarea className="input" rows={3} value={String(node.dep_input2 || "")} onChange={(e) => update({ dep_input2: e.target.value })} placeholder='{"dependencies":{"lodash":"^5.0.0"}}' />
            </BuilderField>
          )}
          {(op === "circular_deps" || op === "dep_tree") && (
            <BuilderField label={t("workflows.dep_graph")} hint={t("workflows.dep_graph_hint")}>
              <textarea className="input" rows={3} value={String(node.dep_graph || "")} onChange={(e) => update({ dep_graph: e.target.value })} placeholder='{"a":["b"],"b":["c"]}' />
            </BuilderField>
          )}
        </>
      )}
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
