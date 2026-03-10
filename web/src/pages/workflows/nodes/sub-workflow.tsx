import { BuilderField, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SubWorkflowEditPanel({ node, update, t, options }: EditPanelProps) {
  const templates = options?.workflow_templates || [];
  return (
    <>
      <BuilderField label={t("workflows.sub_workflow_name")} required>
        {templates.length > 0 ? (
          <select autoFocus className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {templates.map((w) => <option key={w.slug} value={w.slug}>{w.title} ({w.slug})</option>)}
          </select>
        ) : (
          <input autoFocus className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })} placeholder="my-sub-workflow" />
        )}
      </BuilderField>
      <JsonField label={t("workflows.sub_input_mapping")} value={node.input_mapping} onUpdate={(v) => update({ input_mapping: v })} rows={3} placeholder='{"prompt": "{{memory.prev.result}}"}' />
      <BuilderField label={t("workflows.timeout_ms")} hint={t("workflows.timeout_ms_hint")}>
        <input className="input input--sm" type="number" min={1000} value={String(node.timeout_ms ?? 30000)} onChange={(e) => update({ timeout_ms: Number(e.target.value) || 30000 })} />
      </BuilderField>
    </>
  );
}

export const sub_workflow_descriptor: FrontendNodeDescriptor = {
  node_type: "sub_workflow",
  icon: "↪",
  color: "#673ab7",
  shape: "rect",
  toolbar_label: "node.sub_workflow.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.sub_workflow.output.result" },
    { name: "phases", type: "array",  description: "node.sub_workflow.output.phases" },
  ],
  input_schema: [
    { name: "variables", type: "object", description: "node.sub_workflow.input.variables" },
  ],
  create_default: () => ({ workflow_name: "", input_mapping: "", timeout_ms: 30000 }),
  EditPanel: SubWorkflowEditPanel,
};
