import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function FileEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.file_operation")}</label>
          <select autoFocus className="input input--sm" value={String(node.operation || "read")} onChange={(e) => update({ operation: e.target.value })}>
            <option value="read">{t("workflows.opt_read")}</option>
            <option value="write">{t("workflows.opt_write")}</option>
            <option value="extract">{t("workflows.opt_extract")}</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.file_path")}</label>
          <input className="input input--sm" value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="data/input.csv" />
        </div>
      </div>
      {String(node.operation) === "write" && (
        <div className="builder-row">
          <label className="label">{t("workflows.file_content")}</label>
          <textarea className="input code-textarea" rows={4} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} spellCheck={false} placeholder="{{memory.report}}" />
        </div>
      )}
      {String(node.operation) === "extract" && (
        <div className="builder-row">
          <label className="label">{t("workflows.file_format")}</label>
          <select className="input input--sm" value={String(node.format || "text")} onChange={(e) => update({ format: e.target.value })}>
            <option value="text">{t("workflows.opt_text")}</option>
            <option value="json">{t("workflows.opt_json")}</option>
            <option value="csv">{t("workflows.opt_csv")}</option>
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
  toolbar_label: "node.file.label",
  category: "data",
  output_schema: [
    { name: "content", type: "string",  description: "node.file.output.content" },
    { name: "data",    type: "unknown", description: "node.file.output.data" },
    { name: "path",    type: "string",  description: "node.file.output.path" },
  ],
  input_schema: [
    { name: "file_path", type: "string", description: "node.file.input.file_path" },
    { name: "content",   type: "string", description: "node.file.input.content" },
  ],
  create_default: () => ({ operation: "read", file_path: "", format: "text" }),
  EditPanel: FileEditPanel,
};
