import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ArchiveEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.archive_operation")}</label>
          <select autoFocus className="input input--sm" value={String(node.operation || "list")} onChange={(e) => update({ operation: e.target.value })}>
            {["create", "extract", "list"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.archive_format")}</label>
          <select className="input input--sm" value={String(node.format || "tar.gz")} onChange={(e) => update({ format: e.target.value })}>
            <option value="tar.gz">tar.gz</option>
            <option value="zip">zip</option>
          </select>
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.archive_path")}</label>
        <input className="input" value={String(node.archive_path || "")} onChange={(e) => update({ archive_path: e.target.value })} placeholder="backup.tar.gz" />
      </div>
      {node.operation === "create" && (
        <div className="builder-row">
          <label className="label">{t("workflows.archive_files")}</label>
          <input className="input" value={String(node.files || "")} onChange={(e) => update({ files: e.target.value })} placeholder="src/ docs/ README.md" />
        </div>
      )}
      {node.operation === "extract" && (
        <div className="builder-row">
          <label className="label">{t("workflows.output_dir")}</label>
          <input className="input" value={String(node.output_dir || ".")} onChange={(e) => update({ output_dir: e.target.value })} />
        </div>
      )}
    </>
  );
}

export const archive_descriptor: FrontendNodeDescriptor = {
  node_type: "archive",
  icon: "\u{1F4E6}",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.archive.label",
  category: "integration",
  output_schema: [
    { name: "output",  type: "string",  description: "node.archive.output.output" },
    { name: "success", type: "boolean", description: "node.archive.output.success" },
  ],
  input_schema: [
    { name: "operation",    type: "string", description: "node.archive.input.operation" },
    { name: "archive_path", type: "string", description: "node.archive.input.archive_path" },
    { name: "files",        type: "string", description: "node.archive.input.files" },
  ],
  create_default: () => ({ operation: "list", format: "tar.gz", archive_path: "", files: "", output_dir: "." }),
  EditPanel: ArchiveEditPanel,
};
