import { useState } from "react";
import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SubWorkflowEditPanel({ node, update, t, options }: EditPanelProps) {
  const templates = options?.workflow_templates || [];
  const [mappingRaw, setMappingRaw] = useState(node.input_mapping ? JSON.stringify(node.input_mapping, null, 2) : "");
  const [mappingErr, setMappingErr] = useState("");

  const handleMapping = (val: string) => {
    setMappingRaw(val);
    if (!val.trim()) { setMappingErr(""); update({ input_mapping: undefined }); return; }
    try { update({ input_mapping: JSON.parse(val) }); setMappingErr(""); }
    catch { setMappingErr(t("workflows.invalid_json")); }
  };
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
