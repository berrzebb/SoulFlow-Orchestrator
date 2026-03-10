import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function DataFormatEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "convert");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["convert", "query", "validate", "pretty", "flatten", "unflatten", "merge", "pick", "omit"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        {op === "convert" && (
          <BuilderField label={t("workflows.from_format")}>
            <select className="input input--sm" value={String(node.from || "json")} onChange={(e) => update({ from: e.target.value })}>
              {["json", "csv", "yaml", "toml"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      {op === "convert" && (
        <BuilderField label={t("workflows.to_format")}>
          <select className="input input--sm" value={String(node.to || "csv")} onChange={(e) => update({ to: e.target.value })}>
            {["json", "csv", "yaml", "toml"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </BuilderField>
      )}
      <BuilderField label={t("workflows.input_data")}>
        <textarea className="input code-textarea" rows={5} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder='{"key": "value"}' />
      </BuilderField>
      {op === "query" && (
        <BuilderField label={t("workflows.field_json_path")}>
          <input className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="$.users[0].name" />
        </BuilderField>
      )}
      {(op === "pick" || op === "omit") && (
        <BuilderField label={t("workflows.keys")}>
          <input className="input input--sm" value={String(node.keys || "")} onChange={(e) => update({ keys: e.target.value })} placeholder="name, email, age" />
        </BuilderField>
      )}
      {op === "merge" && (
        <BuilderField label={t("workflows.input_data_secondary")}>
          <textarea className="input code-textarea" rows={3} value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder='{"extra": true}' />
        </BuilderField>
      )}
    </>
  );
}

export const data_format_descriptor: FrontendNodeDescriptor = {
  node_type: "data_format",
  icon: "\u{1F504}",
  color: "#00838f",
  shape: "rect",
  toolbar_label: "node.data_format.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.data_format.output.result" },
    { name: "success", type: "boolean", description: "node.data_format.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.data_format.input.operation" },
    { name: "input",     type: "string", description: "node.data_format.input.input" },
    { name: "from",      type: "string", description: "node.data_format.input.from" },
    { name: "to",        type: "string", description: "node.data_format.input.to" },
  ],
  create_default: () => ({ operation: "convert", input: "", from: "json", to: "csv", path: "", keys: "", input2: "", delimiter: "," }),
  EditPanel: DataFormatEditPanel,
};
