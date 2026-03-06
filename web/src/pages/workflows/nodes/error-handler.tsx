import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ErrorHandlerEditPanel({ node, update, t }: EditPanelProps) {
  const on_error = String(node.on_error || "continue");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.error_try_nodes")}</label>
        <input className="input input--sm" value={String(node.try_nodes || "")} onChange={(e) => update({ try_nodes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="node_1, node_2" />
        <span className="builder-hint">{t("workflows.error_try_nodes_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.error_on_error")}</label>
        <select className="input input--sm" value={on_error} onChange={(e) => update({ on_error: e.target.value })}>
          <option value="continue">{t("workflows.error_continue")}</option>
          <option value="fallback">{t("workflows.error_fallback")}</option>
        </select>
      </div>
      {on_error === "fallback" && (
        <div className="builder-row">
          <label className="label">{t("workflows.error_fallback_nodes")}</label>
          <input className="input input--sm" value={String(node.fallback_nodes || "")} onChange={(e) => update({ fallback_nodes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="fallback_node_1" />
        </div>
      )}
    </>
  );
}

export const error_handler_descriptor: FrontendNodeDescriptor = {
  node_type: "error_handler",
  icon: "🛡",
  color: "#f44336",
  shape: "rect",
  toolbar_label: "+ Error",
  category: "flow",
  output_schema: [
    { name: "has_error",  type: "boolean", description: "Whether an error occurred" },
    { name: "error",      type: "string",  description: "Error message (if any)" },
    { name: "error_node", type: "string",  description: "Node that caused the error" },
    { name: "output",     type: "object",  description: "Successful output (if no error)" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "Pass-through data" },
  ],
  create_default: () => ({ try_nodes: [], on_error: "continue" }),
  EditPanel: ErrorHandlerEditPanel,
};
