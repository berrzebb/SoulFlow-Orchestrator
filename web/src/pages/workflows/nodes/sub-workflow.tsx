import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { useJsonField } from "../use-json-field";

function SubWorkflowEditPanel({ node, update, t, options }: EditPanelProps) {
  const templates = options?.workflow_templates || [];
  const { raw: mappingRaw, err: mappingErr, onChange: handleMapping } = useJsonField(node.input_mapping, (v) => update({ input_mapping: v }));
  return (
    <>
      <BuilderField label={t("workflows.sub_workflow_name")}>
        {templates.length > 0 ? (
          <select autoFocus className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })}>
            <option value="">{t("common.select")}</option>
            {templates.map((w) => <option key={w.slug} value={w.slug}>{w.title} ({w.slug})</option>)}
          </select>
        ) : (
          <input autoFocus className="input input--sm" value={String(node.workflow_name || "")} onChange={(e) => update({ workflow_name: e.target.value })} placeholder="my-sub-workflow" />
        )}
      </BuilderField>
      <BuilderField label={t("workflows.sub_input_mapping")} error={mappingErr}>
        <textarea
          className={`input code-textarea${mappingErr ? " input--err" : ""}`}
          rows={3}
          value={mappingRaw}
          onChange={(e) => handleMapping(e.target.value)}
          spellCheck={false}
          placeholder='{"prompt": "{{memory.prev.result}}"}'
        />
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
  create_default: () => ({ workflow_name: "" }),
  EditPanel: SubWorkflowEditPanel,
};
