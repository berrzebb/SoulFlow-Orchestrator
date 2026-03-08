import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ErrorHandlerEditPanel({ node, update, t }: EditPanelProps) {
  const on_error = String(node.on_error || "continue");
  return (
    <>
      <BuilderField label={t("workflows.error_try_nodes")} hint={t("workflows.error_try_nodes_hint")}>
        <input autoFocus className="input input--sm" value={String(node.try_nodes || "")} onChange={(e) => update({ try_nodes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="node_1, node_2" />
      </BuilderField>
      <BuilderField label={t("workflows.error_on_error")}>
        <select className="input input--sm" value={on_error} onChange={(e) => update({ on_error: e.target.value })}>
          <option value="continue">{t("workflows.error_continue")}</option>
          <option value="fallback">{t("workflows.error_fallback")}</option>
        </select>
      </BuilderField>
      {on_error === "fallback" && (
        <BuilderField label={t("workflows.error_fallback_nodes")}>
          <input className="input input--sm" value={String(node.fallback_nodes || "")} onChange={(e) => update({ fallback_nodes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="fallback_node_1" />
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
  create_default: () => ({ try_nodes: [], on_error: "continue" }),
  EditPanel: ErrorHandlerEditPanel,
};
