import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function ArchiveEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.archive_operation")} required>
          <select autoFocus className="input input--sm" value={String(node.operation || "list")} onChange={(e) => update({ operation: e.target.value })}>
            {["create", "extract", "list"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.archive_format")}>
          <select className="input input--sm" value={String(node.format || "tar.gz")} onChange={(e) => update({ format: e.target.value })}>
            <option value="tar.gz">tar.gz</option>
            <option value="zip">zip</option>
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.archive_path")}>
        <input className="input" value={String(node.archive_path || "")} onChange={(e) => update({ archive_path: e.target.value })} placeholder="backup.tar.gz" />
      </BuilderField>
      {node.operation === "create" && (
        <BuilderField label={t("workflows.archive_files")}>
          <input className="input" value={String(node.files || "")} onChange={(e) => update({ files: e.target.value })} placeholder="src/ docs/ README.md" />
        </BuilderField>
      )}
      {node.operation === "extract" && (
        <BuilderField label={t("workflows.output_dir")}>
          <input className="input" value={String(node.output_dir || ".")} onChange={(e) => update({ output_dir: e.target.value })} />
        </BuilderField>
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
