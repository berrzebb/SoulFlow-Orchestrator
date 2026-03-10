import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse_json", "parse_apache", "parse_nginx", "parse_syslog", "parse_custom", "filter", "stats", "tail"];

function LogParserEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse_json");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.log_input")} required>
        <textarea className="input" required rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="log lines..." aria-required="true" />
      </BuilderField>
      {action === "parse_custom" && (
        <BuilderField label={t("workflows.field_pattern_regex")}>
          <input className="input input--sm" value={String(node.pattern || "")} onChange={(e) => update({ pattern: e.target.value })} placeholder="(?P<level>\w+) (?P<msg>.*)" />
        </BuilderField>
      )}
      {action === "filter" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_field")}>
            <input className="input input--sm" value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="level" />
          </BuilderField>
          <BuilderField label={t("workflows.field_value")}>
            <input className="input input--sm" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="ERROR" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {action === "filter" && (
        <BuilderField label={t("workflows.log_level")}>
          <select className="input input--sm" value={String(node.level || "")} onChange={(e) => update({ level: e.target.value || undefined })}>
            <option value="">(any)</option>
            {["DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </BuilderField>
      )}
    </>
  );
}

export const log_parser_descriptor: FrontendNodeDescriptor = {
  node_type: "log_parser",
  icon: "📜",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.log_parser.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.log_parser.output.result" },
    { name: "success", type: "boolean", description: "node.log_parser.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.log_parser.input.action" },
    { name: "input", type: "string", description: "node.log_parser.input.input" },
  ],
  create_default: () => ({ action: "parse_json", input: "", pattern: "", field: "", value: "", level: "" }),
  EditPanel: LogParserEditPanel,
};
