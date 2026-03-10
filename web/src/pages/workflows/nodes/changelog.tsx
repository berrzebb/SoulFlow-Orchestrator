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
        {(action === "generate" || action === "parse_commits") && (
          <BuilderField label={t("workflows.changelog_version")}>
            <input className="input input--sm" value={String(node.version || "")} onChange={(e) => update({ version: e.target.value })} placeholder="v1.1.0" />
          </BuilderField>
        )}
      </BuilderRowPair>
      {(action === "parse_commits" || action === "generate" || action === "group_by_type") && (
        <BuilderField label={t("workflows.changelog_commits")} required>
          <textarea className="input" required rows={4} value={String(node.commits || "")} onChange={(e) => update({ commits: e.target.value })} placeholder="feat: add new feature&#10;fix: resolve bug" aria-required="true" />
        </BuilderField>
      )}
      {(action === "format_entry" || action === "validate_commit") && (
        <BuilderField label={t("workflows.changelog_commit_message")} required>
          <input className="input input--sm" required value={String(node.commit_message || "")} onChange={(e) => update({ commit_message: e.target.value })} placeholder="feat: add new feature" aria-required="true" />
        </BuilderField>
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
    { name: "commits", type: "string", description: "node.changelog.input.commits" },
  ],
  create_default: () => ({ action: "generate", commits: "", version: "", commit_message: "" }),
  EditPanel: ChangelogEditPanel,
};
