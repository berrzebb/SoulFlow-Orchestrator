import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function ValidatorEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "format");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["schema", "format", "rules"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder='{"email": "test@test.com"}' />
      </BuilderField>
      {op === "format" && (
        <BuilderField label={t("workflows.format")}>
          <select className="input input--sm" value={String(node.format || "json")} onChange={(e) => update({ format: e.target.value })}>
            {["email", "url", "ip", "date", "uuid", "json", "number"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </BuilderField>
      )}
      {op === "schema" && (
        <BuilderField label={t("workflows.field_json_schema")}>
          <textarea className="input code-textarea" rows={4} value={String(node.schema || "{}")} onChange={(e) => update({ schema: e.target.value })} placeholder='{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}' />
        </BuilderField>
      )}
      {op === "rules" && (
        <BuilderField label={t("workflows.field_rules")}>
          <textarea className="input code-textarea" rows={4} value={String(node.rules || "[]")} onChange={(e) => update({ rules: e.target.value })} placeholder='[{"field":"age","type":"number","min":0,"max":150}]' />
        </BuilderField>
      )}
    </>
  );
}

export const validator_descriptor: FrontendNodeDescriptor = {
  node_type: "validator",
  icon: "\u{2705}",
  color: "#2e7d32",
  shape: "diamond",
  toolbar_label: "node.validator.label",
  category: "data",
  output_schema: [
    { name: "valid",       type: "boolean", description: "node.validator.output.valid" },
    { name: "error_count", type: "number",  description: "node.validator.output.error_count" },
    { name: "errors",      type: "array",   description: "node.validator.output.errors" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.validator.input.operation" },
    { name: "input",     type: "string", description: "node.validator.input.input" },
  ],
  create_default: () => ({ operation: "format", input: "", format: "json", schema: "{}", rules: "[]" }),
  EditPanel: ValidatorEditPanel,
};
