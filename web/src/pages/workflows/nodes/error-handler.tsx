import { BuilderField, NodeMultiSelect } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ErrorHandlerEditPanel({ node, update, t, options }: EditPanelProps) {
  const on_error = String(node.on_error || "continue");
  const try_nodes = Array.isArray(node.try_nodes) ? node.try_nodes as string[] : [];
  const fallback_nodes = Array.isArray(node.fallback_nodes) ? node.fallback_nodes as string[] : [];
  return (
    <>
      <BuilderField label={t("workflows.error_try_nodes")} hint={t("workflows.error_try_nodes_hint")}>
        <NodeMultiSelect value={try_nodes} onChange={(ids) => update({ try_nodes: ids })} nodes={options?.workflow_nodes} />
      </BuilderField>
      <BuilderField label={t("workflows.error_on_error")}>
        <select className="input input--sm" value={on_error} onChange={(e) => update({ on_error: e.target.value })}>
          <option value="continue">{t("workflows.error_continue")}</option>
          <option value="fallback">{t("workflows.error_fallback")}</option>
        </select>
      </BuilderField>
      {on_error === "fallback" && (
        <BuilderField label={t("workflows.error_fallback_nodes")}>
          <NodeMultiSelect value={fallback_nodes} onChange={(ids) => update({ fallback_nodes: ids })} nodes={options?.workflow_nodes} />
        </BuilderField>
      )}
    </>
  );
}

export const error_handler_descriptor: FrontendNodeDescriptor = {
  node_type: "error_handler",
  icon: "🛡",
  color: "#f44336",
  shape: "rect",
  toolbar_label: "node.error_handler.label",
  category: "flow",
  output_schema: [
    { name: "has_error",  type: "boolean", description: "node.error_handler.output.has_error" },
    { name: "error",      type: "string",  description: "node.error_handler.output.error" },
    { name: "error_node", type: "string",  description: "node.error_handler.output.error_node" },
    { name: "output",     type: "object",  description: "node.error_handler.output.output" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "node.error_handler.input.data" },
  ],
  create_default: () => ({ try_nodes: [], on_error: "continue", fallback_nodes: [] }),
  EditPanel: ErrorHandlerEditPanel,
};
