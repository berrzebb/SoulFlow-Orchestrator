import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SubWorkflowEditPanel({ node, update, t, options }: EditPanelProps) {
  const templates = options?.workflow_templates || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.sub_workflow_name")}</label>
        {templates.length > 0 ? (
          <select className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })}>
            <option value="">{t("common.select") || "— Select —"}</option>
            {templates.map((w) => <option key={w.slug} value={w.slug}>{w.title} ({w.slug})</option>)}
          </select>
        ) : (
          <input className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })} placeholder="my-sub-workflow" />
        )}
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.sub_input_mapping")}</label>
        <textarea className="input code-textarea" rows={3} value={node.input_mapping ? JSON.stringify(node.input_mapping, null, 2) : ""} onChange={(e) => { try { update({ input_mapping: e.target.value ? JSON.parse(e.target.value) : undefined }); } catch { /* ignore */ } }} spellCheck={false} placeholder='{"prompt": "{{memory.prev.result}}"}' />
      </div>
    </>
  );
}

export const sub_workflow_descriptor: FrontendNodeDescriptor = {
  node_type: "sub_workflow",
  icon: "↪",
  color: "#673ab7",
  shape: "rect",
  toolbar_label: "+ Sub",
  output_schema: [
    { name: "result", type: "object", description: "Sub-workflow final output" },
    { name: "phases", type: "array",  description: "Phase results array" },
  ],
  input_schema: [
    { name: "variables", type: "object", description: "Input variables for sub-workflow" },
  ],
  create_default: () => ({ workflow_name: "" }),
  EditPanel: SubWorkflowEditPanel,
};
