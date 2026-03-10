import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const YAML_ACTIONS = ["parse", "generate", "merge", "validate", "query"];
const DOTENV_ACTIONS = ["parse", "generate", "merge", "validate", "diff"];

function YamlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  const format = String(node.format || "yaml");
  const is_dotenv = format === "dotenv";
  const actions = is_dotenv ? DOTENV_ACTIONS : YAML_ACTIONS;
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {actions.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
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
              <option value="ini">INI</option>
              <option value="dotenv">.env</option>
            </select>
          </BuilderField>
        )}
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input" required rows={4} value={String(node.data || "")}
          onChange={(e) => update({ data: e.target.value })}
          placeholder={action === "generate" ? (is_dotenv ? '{"KEY":"value","DEBUG":"true"}' : '{"key": "value"}') : (is_dotenv ? "KEY=value\nDEBUG=true" : "key: value")}
          aria-required="true" />
      </BuilderField>
      {(action === "merge" || action === "diff") && (
        <BuilderField label={t("workflows.field_input_2")} required>
          <textarea className="input" required rows={3} value={String(node.data2 || "")}
            onChange={(e) => update({ data2: e.target.value })}
            placeholder={is_dotenv ? "KEY=other\nNEW_KEY=value" : "other: value"}
            aria-required="true" />
        </BuilderField>
      )}
      {action === "validate" && is_dotenv && (
        <BuilderField label={t("workflows.dotenv_required_keys")} hint={t("workflows.dotenv_required_keys_hint")}>
          <input className="input input--sm" value={String(node.required_keys || "")} onChange={(e) => update({ required_keys: e.target.value })} placeholder="DATABASE_URL,SECRET_KEY" />
        </BuilderField>
      )}
      {action === "query" && format !== "ini" && !is_dotenv && (
        <BuilderField label={t("workflows.field_query")} required>
          <input className="input input--sm" required value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder=".key.nested" aria-required="true" />
        </BuilderField>
      )}
      {action === "query" && format === "ini" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.ini_section")}>
            <input className="input input--sm" value={String(node.ini_section || "")} onChange={(e) => update({ ini_section: e.target.value })} placeholder="[section]" />
          </BuilderField>
          <BuilderField label={t("workflows.ini_key")}>
            <input className="input input--sm" value={String(node.ini_key || "")} onChange={(e) => update({ ini_key: e.target.value })} placeholder="key" />
          </BuilderField>
        </BuilderRowPair>
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
  create_default: () => ({ action: "parse", data: "", data2: "", path: "", indent: 2, format: "yaml", required_keys: "" }),
  EditPanel: YamlEditPanel,
};
