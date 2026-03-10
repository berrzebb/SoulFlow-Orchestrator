import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "merge", "validate", "query"];

function YamlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  const format = String(node.format || "yaml");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        {action === "generate" && format === "yaml" ? (
          <BuilderField label={t("workflows.yaml_indent")}>
            <input className="input input--sm" type="number" min={1} max={8} value={String(node.indent ?? 2)} onChange={(e) => update({ indent: Number(e.target.value) || 2 })} />
          </BuilderField>
        ) : (
          <BuilderField label={t("workflows.field_format")}>
            <select className="input input--sm" value={format} onChange={(e) => update({ format: e.target.value })}>
              <option value="yaml">YAML</option>
              <option value="toml">TOML</option>
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input" required rows={4} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder={action === "generate" ? '{"key": "value"}' : "key: value"} aria-required="true" />
      </BuilderField>
      {action === "merge" && (
        <BuilderField label={t("workflows.field_input_2")} required>
          <textarea className="input" required rows={3} value={String(node.data2 || "")} onChange={(e) => update({ data2: e.target.value })} placeholder="other: value" aria-required="true" />
        </BuilderField>
      )}
      {action === "query" && (
        <BuilderField label={t("workflows.field_query")} required>
          <input className="input input--sm" required value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder=".key.nested" aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const yaml_descriptor: FrontendNodeDescriptor = {
  node_type: "yaml",
  icon: "📃",
  color: "#9e9e9e",
  shape: "rect",
  toolbar_label: "node.yaml.label",
  category: "data",
  output_schema: [
    { name: "result", type: "object", description: "node.yaml.output.result" },
    { name: "success", type: "boolean", description: "node.yaml.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.yaml.input.action" },
    { name: "data", type: "string", description: "node.yaml.input.data" },
  ],
  create_default: () => ({ action: "parse", data: "", data2: "", path: "", indent: 2, format: "yaml" }),
  EditPanel: YamlEditPanel,
};
