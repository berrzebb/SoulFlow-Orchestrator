import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse_commits", "generate", "group_by_type", "format_entry", "validate_commit"];

function ChangelogEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
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
        <textarea className="input input--sm" required rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="feat: add new feature&#10;fix: resolve bug" aria-required="true" />
      </BuilderField>
      {(action === "generate" || action === "parse_commits") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.changelog_from_tag")}>
            <input className="input input--sm" value={String(node.from_tag || "")} onChange={(e) => update({ from_tag: e.target.value })} placeholder="v1.0.0" />
          </BuilderField>
          <BuilderField label={t("workflows.changelog_to_tag")}>
            <input className="input input--sm" value={String(node.to_tag || "")} onChange={(e) => update({ to_tag: e.target.value })} placeholder="v1.1.0" />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const changelog_descriptor: FrontendNodeDescriptor = {
  node_type: "changelog",
  icon: "📝",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.changelog.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.changelog.output.result" },
    { name: "success", type: "boolean", description: "node.changelog.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.changelog.input.action" },
    { name: "input", type: "string", description: "node.changelog.input.input" },
  ],
  create_default: () => ({ action: "generate", input: "", from_tag: "", to_tag: "" }),
  EditPanel: ChangelogEditPanel,
};
