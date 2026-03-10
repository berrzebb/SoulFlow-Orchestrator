import { BuilderField, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["validate", "generate", "draft_convert", "merge", "diff", "dereference", "mock"];

function JsonSchemaEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "validate");
  const needs_schema2 = ["merge", "diff"].includes(action);
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <JsonField label={t("workflows.json_schema_schema_json")} value={node.schema} onUpdate={(v) => update({ schema: v })} placeholder='{"type": "object"}' />
      {action === "validate" && (
        <JsonField label={t("workflows.json_schema_data_json")} value={node.data} onUpdate={(v) => update({ data: v })} placeholder='{"key": "value"}' />
      )}
      {action === "draft_convert" && (
        <BuilderField label={t("workflows.json_schema_target_draft")}>
          <select className="input input--sm" value={String(node.target_draft || "draft-07")} onChange={(e) => update({ target_draft: e.target.value })}>
            {["draft-04", "draft-06", "draft-07", "draft-2019-09", "draft-2020-12"].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </BuilderField>
      )}
      {needs_schema2 && (
        <JsonField label={t("workflows.json_schema_schema2_json")} value={node.schema2} onUpdate={(v) => update({ schema2: v })} placeholder='{"type": "object"}' />
      )}
    </>
  );
}

export const json_schema_descriptor: FrontendNodeDescriptor = {
  node_type: "json_schema",
  icon: "📋",
  color: "#5c6bc0",
  shape: "rect",
  toolbar_label: "node.json_schema.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.json_schema.output.result" },
    { name: "success", type: "boolean", description: "node.json_schema.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.json_schema.input.action" },
    { name: "schema", type: "string", description: "node.json_schema.input.schema" },
    { name: "data", type: "string", description: "node.json_schema.input.data" },
  ],
  create_default: () => ({ action: "validate", schema: "", data: "" }),
  EditPanel: JsonSchemaEditPanel,
};
