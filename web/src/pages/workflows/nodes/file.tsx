import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FileEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.file_operation") || "Operation"}</label>
          <select className="input input--sm" value={String(node.operation || "read")} onChange={(e) => update({ operation: e.target.value })}>
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="extract">Extract</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.file_path") || "File Path"}</label>
          <input className="input input--sm" value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="data/input.csv" />
        </div>
      </div>
      {String(node.operation) === "write" && (
        <div className="builder-row">
          <label className="label">{t("workflows.file_content") || "Content"}</label>
          <textarea className="input code-textarea" rows={4} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} spellCheck={false} placeholder="{{memory.report}}" />
        </div>
      )}
      {String(node.operation) === "extract" && (
        <div className="builder-row">
          <label className="label">{t("workflows.file_format") || "Format"}</label>
          <select className="input input--sm" value={String(node.format || "text")} onChange={(e) => update({ format: e.target.value })}>
            <option value="text">Text</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      )}
    </>
  );
}

export const file_descriptor: FrontendNodeDescriptor = {
  node_type: "file",
  icon: "📄",
  color: "#7f8c8d",
  shape: "rect",
  toolbar_label: "+ File",
  category: "data",
  output_schema: [
    { name: "content", type: "string",  description: "File content" },
    { name: "data",    type: "unknown", description: "Parsed data (extract)" },
    { name: "path",    type: "string",  description: "Resolved file path" },
  ],
  input_schema: [
    { name: "file_path", type: "string", description: "File path" },
    { name: "content",   type: "string", description: "Content to write" },
  ],
  create_default: () => ({ operation: "read", file_path: "", format: "text" }),
  EditPanel: FileEditPanel,
};
