import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "merge", "validate", "query"];

function YamlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input input--sm" required rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="key: value" aria-required="true" />
      </BuilderField>
      {action === "merge" && (
        <BuilderField label={t("workflows.field_input_2")} required>
          <textarea className="input input--sm" required rows={3} value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder="other: value" aria-required="true" />
        </BuilderField>
      )}
      {action === "query" && (
        <BuilderField label={t("workflows.field_query")} required>
          <input className="input input--sm" required value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder=".key.nested" aria-required="true" />
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
    { name: "result", type: "string", description: "node.yaml.output.result" },
    { name: "success", type: "boolean", description: "node.yaml.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.yaml.input.action" },
    { name: "input", type: "string", description: "node.yaml.input.input" },
  ],
  create_default: () => ({ action: "parse", input: "" }),
  EditPanel: YamlEditPanel,
};
