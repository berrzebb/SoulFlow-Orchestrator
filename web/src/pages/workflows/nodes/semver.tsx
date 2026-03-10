import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const SEMVER_ACTIONS = ["parse", "compare", "satisfies", "bump", "sort", "diff", "valid"] as const;
const BUMP_TYPES = ["major", "minor", "patch", "prerelease"] as const;

function SemverEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "valid");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {SEMVER_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {action !== "sort" && (
        <BuilderField label={t("workflows.semver_version")} required>
          <input className="input" value={String(node.version || "")} onChange={(e) => update({ version: e.target.value })} placeholder="1.2.3" />
        </BuilderField>
      )}
      {(action === "compare" || action === "diff") && (
        <BuilderField label={t("workflows.semver_version2")} required>
          <input className="input" value={String(node.version2 || "")} onChange={(e) => update({ version2: e.target.value })} placeholder="2.0.0" />
        </BuilderField>
      )}
      {action === "satisfies" && (
        <BuilderField label={t("workflows.semver_range")} required>
          <input className="input" value={String(node.range || "")} onChange={(e) => update({ range: e.target.value })} placeholder=">=1.0.0 <2.0.0" />
        </BuilderField>
      )}
      {action === "bump" && (
        <BuilderField label={t("workflows.semver_bump_type")}>
          <select className="input input--sm" value={String(node.bump_type || "patch")} onChange={(e) => update({ bump_type: e.target.value })}>
            {BUMP_TYPES.map((b) => <option key={b} value={b}>{t(`node.action.${b}`)}</option>)}
          </select>
        </BuilderField>
      )}
      {action === "sort" && (
        <BuilderField label={t("workflows.semver_versions")} hint={t("workflows.semver_versions_hint")}>
          <input className="input" value={String(node.versions || "")} onChange={(e) => update({ versions: e.target.value })} placeholder="1.0.0,2.1.3,0.9.5" />
        </BuilderField>
      )}
    </>
  );
}

export const semver_descriptor: FrontendNodeDescriptor = {
  node_type: "semver",
  icon: "\u{1F4CC}",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.semver.label",
  category: "data",
  output_schema: [
    { name: "valid",     type: "boolean", description: "node.semver.output.valid" },
    { name: "result",    type: "string",  description: "node.semver.output.result" },
    { name: "sorted",    type: "array",   description: "node.semver.output.sorted" },
    { name: "satisfies", type: "boolean", description: "node.semver.output.satisfies" },
    { name: "diff",      type: "string",  description: "node.semver.output.diff" },
    { name: "bumped",    type: "string",  description: "node.semver.output.bumped" },
  ],
  input_schema: [
    { name: "action",  type: "string", description: "node.semver.input.action" },
    { name: "version", type: "string", description: "node.semver.input.version" },
  ],
  create_default: () => ({ action: "valid", version: "", version2: "", range: "", bump_type: "patch", versions: "" }),
  EditPanel: SemverEditPanel,
};
