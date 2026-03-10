import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, JsonField } from "../builder-field";

function ToolInvokeEditPanel({ node, update, t, options }: EditPanelProps) {
  const available = options?.available_tools || [];
  const toolId = String(node.tool_id || "");
  const defs = options?.tool_definitions || [];
  const selectedDef = defs.find((d) => d.id === toolId || d.tool_id === toolId);

  return (
    <>
      <BuilderField label={t("workflows.tool_invoke_id")} required hint={t("workflows.tool_invoke_id_hint")}>
        <select autoFocus required className="input input--sm" value={toolId} onChange={(e) => update({ tool_id: e.target.value })} aria-required="true">
          <option value="">{t("common.select")}</option>
          {available.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </BuilderField>
      {selectedDef && (
        <div className="builder-row">
          <span className="muted">{String(selectedDef.description || "")}</span>
        </div>
      )}
      <JsonField label={t("workflows.tool_invoke_params")} hint={t("workflows.tool_invoke_params_hint")} value={node.params} onUpdate={(v) => update({ params: v })} rows={5} placeholder='{ "key": "{{memory.value}}" }' />
      <BuilderField label={t("workflows.hitl_timeout")} required>
        <input required className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} aria-required="true" />
      </BuilderField>
    </>
  );
}

export const tool_invoke_descriptor: FrontendNodeDescriptor = {
  node_type: "tool_invoke",
  icon: "🔧",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.tool_invoke.label",
  category: "advanced",
  output_schema: [
    { name: "result",   type: "unknown", description: "node.tool_invoke.output.result" },
    { name: "tool_id",  type: "string",  description: "node.tool_invoke.output.tool_id" },
    { name: "duration", type: "number",  description: "node.tool_invoke.output.duration" },
    { name: "ok",       type: "boolean", description: "node.tool_invoke.output.ok" },
    { name: "error",    type: "string",  description: "node.tool_invoke.output.error" },
  ],
  input_schema: [
    { name: "tool_id", type: "string", description: "node.tool_invoke.input.tool_id" },
    { name: "params",  type: "object", description: "node.tool_invoke.input.params" },
  ],
  create_default: () => ({ tool_id: "", params: {}, timeout_ms: 30000 }),
  EditPanel: ToolInvokeEditPanel,
};
