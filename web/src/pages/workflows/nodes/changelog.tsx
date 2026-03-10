import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const CHANGELOG_ACTIONS = ["parse_commits", "generate", "group_by_type", "format_entry", "validate_commit"];
const LICENSE_ACTIONS = ["license_generate", "license_detect", "license_info", "license_compare", "license_list", "license_compatible"];

function ChangelogEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
  const is_license = LICENSE_ACTIONS.includes(action);
  return (
    <>
      {(action === "generate" || action === "parse_commits") ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              <optgroup label="Changelog">{CHANGELOG_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
              <optgroup label="License">{LICENSE_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.changelog_version")}>
            <input className="input input--sm" value={String(node.version || "")} onChange={(e) => update({ version: e.target.value })} placeholder="v1.1.0" />
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            <optgroup label="Changelog">{CHANGELOG_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
            <optgroup label="License">{LICENSE_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>
          </select>
        </BuilderField>
      )}
      {!is_license && (action === "parse_commits" || action === "generate" || action === "group_by_type") && (
        <BuilderField label={t("workflows.changelog_commits")} required>
          <textarea className="input" required rows={4} value={String(node.commits || "")} onChange={(e) => update({ commits: e.target.value })} placeholder="feat: add new feature&#10;fix: resolve bug" aria-required="true" />
        </BuilderField>
      )}
      {!is_license && (action === "format_entry" || action === "validate_commit") && (
        <BuilderField label={t("workflows.changelog_commit_message")} required>
          <input className="input input--sm" required value={String(node.commit_message || "")} onChange={(e) => update({ commit_message: e.target.value })} placeholder="feat: add new feature" aria-required="true" />
        </BuilderField>
      )}
      {is_license && (
        <>
          {(action === "license_generate" || action === "license_info" || action === "license_compare" || action === "license_compatible") && (
            <BuilderField label={t("workflows.license_id")} required hint={t("workflows.license_id_hint")}>
              <input className="input input--sm" value={String(node.license_id || "")} onChange={(e) => update({ license_id: e.target.value })} placeholder="MIT" />
            </BuilderField>
          )}
          {action === "license_compare" && (
            <BuilderField label={t("workflows.license_id2")} required>
              <input className="input input--sm" value={String(node.license_id2 || "")} onChange={(e) => update({ license_id2: e.target.value })} placeholder="Apache-2.0" />
            </BuilderField>
          )}
          {action === "license_generate" && (
            <>
              <BuilderRowPair>
                <BuilderField label={t("workflows.license_author")}>
                  <input className="input input--sm" value={String(node.license_author || "")} onChange={(e) => update({ license_author: e.target.value })} placeholder="John Doe" />
                </BuilderField>
                <BuilderField label={t("workflows.license_year")}>
                  <input className="input input--sm" value={String(node.license_year || "")} onChange={(e) => update({ license_year: e.target.value })} placeholder={String(new Date().getFullYear())} />
                </BuilderField>
              </BuilderRowPair>
            </>
          )}
          {action === "license_detect" && (
            <BuilderField label={t("workflows.license_text")} required>
              <textarea className="input" rows={5} value={String(node.license_text || "")} onChange={(e) => update({ license_text: e.target.value })} placeholder="MIT License&#10;Copyright (c) ..." />
            </BuilderField>
          )}
        </>
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
    { name: "result", type: "object", description: "node.changelog.output.result" },
    { name: "success", type: "boolean", description: "node.changelog.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.changelog.input.action" },
    { name: "commits", type: "string", description: "node.changelog.input.commits" },
  ],
  create_default: () => ({ action: "generate", commits: "", version: "", commit_message: "", license_id: "MIT", license_id2: "", license_author: "", license_year: String(new Date().getFullYear()), license_text: "" }),
  EditPanel: ChangelogEditPanel,
};
