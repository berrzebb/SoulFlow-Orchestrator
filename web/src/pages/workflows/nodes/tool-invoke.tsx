import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ToolInvokeEditPanel({ node, update, t, options }: EditPanelProps) {
  const available = options?.available_tools || [];
  const toolId = String(node.tool_id || "");
  const defs = options?.tool_definitions || [];
  const selectedDef = defs.find((d) => d.id === toolId || d.tool_id === toolId);
  const paramsJson = (() => {
    try { return JSON.stringify(node.params || {}, null, 2); } catch { return "{}"; }
  })();

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.tool_invoke_id")}</label>
        <select className="input input--sm" value={toolId} onChange={(e) => update({ tool_id: e.target.value })}>
          <option value="">{t("common.select")}</option>
          {available.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <span className="builder-hint">{t("workflows.tool_invoke_id_hint")}</span>
      </div>
      {selectedDef && (
        <div className="builder-row">
          <span className="muted">{String(selectedDef.description || "")}</span>
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.tool_invoke_params")}</label>
        <textarea className="input" rows={5} value={paramsJson} onChange={(e) => {
          try { update({ params: JSON.parse(e.target.value) }); } catch { /* invalid json */ }
        }} placeholder='{ "key": "{{memory.value}}" }' />
        <span className="builder-hint">{t("workflows.tool_invoke_params_hint")}</span>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.hitl_timeout")}</label>
        <input className="input input--sm" type="number" min={0} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) })} />
      </div>
    </>
  );
}

export const tool_invoke_descriptor: FrontendNodeDescriptor = {
  node_type: "tool_invoke",
  icon: "🔧",
  color: "#795548",
  shape: "rect",
  toolbar_label: "+ Tool Invoke",
  category: "advanced",
  output_schema: [
    { name: "result",   type: "unknown", description: "Tool execution result" },
    { name: "tool_id",  type: "string",  description: "Resolved tool ID" },
    { name: "duration", type: "number",  description: "Execution duration (ms)" },
    { name: "ok",       type: "boolean", description: "Whether execution succeeded" },
    { name: "error",    type: "string",  description: "Error message if failed" },
  ],
  input_schema: [
    { name: "tool_id", type: "string", description: "Tool ID (override)" },
    { name: "params",  type: "object", description: "Tool parameters (override)" },
  ],
  create_default: () => ({ tool_id: "", params: {}, timeout_ms: 30000 }),
  EditPanel: ToolInvokeEditPanel,
};
