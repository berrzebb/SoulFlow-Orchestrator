import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MarkdownEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "table");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["table", "list", "checklist", "toc", "html_to_md", "badge", "link", "image", "code_block", "details", "task_list"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {["table", "list", "checklist", "task_list"].includes(op) && (
        <div className="builder-row">
          <label className="label">{t("workflows.input_data")}</label>
          <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder={op === "table" ? '[{"name":"a","value":1}]' : '["item1","item2"]'} />
        </div>
      )}
      {op === "table" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_columns")}</label>
          <input className="input" value={String(node.columns || "")} onChange={(e) => update({ columns: e.target.value })} placeholder="name, value (auto-detect if empty)" />
        </div>
      )}
      {["toc", "html_to_md", "details"].includes(op) && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_text")}</label>
          <textarea className="input code-textarea" rows={4} value={String(node.text || "")} onChange={(e) => update({ text: e.target.value })} />
        </div>
      )}
      {op === "code_block" && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.field_language")}</label>
            <input className="input input--sm" value={String(node.language || "")} onChange={(e) => update({ language: e.target.value })} placeholder="javascript" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_code")}</label>
            <textarea className="input code-textarea" rows={4} value={String(node.code || "")} onChange={(e) => update({ code: e.target.value })} />
          </div>
        </>
      )}
      {["link", "badge", "image"].includes(op) && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{op === "image" ? "Alt" : "Label"}</label>
            <input className="input input--sm" value={String(node.label || node.alt || "")} onChange={(e) => update(op === "image" ? { alt: e.target.value } : { label: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_url")}</label>
            <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} />
          </div>
        </div>
      )}
      {op === "list" && (
        <div className="builder-row">
          <label className="label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input type="checkbox" checked={Boolean(node.ordered)} onChange={(e) => update({ ordered: e.target.checked })} />
            Ordered
          </label>
        </div>
      )}
    </>
  );
}

export const markdown_descriptor: FrontendNodeDescriptor = {
  node_type: "markdown",
  icon: "\u{1F4DD}",
  color: "#263238",
  shape: "rect",
  toolbar_label: "node.markdown.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.markdown.output.result" },
    { name: "success", type: "boolean", description: "node.markdown.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.markdown.input.operation" },
    { name: "data",      type: "string", description: "node.markdown.input.data" },
  ],
  create_default: () => ({ operation: "table", data: "", text: "", columns: "", ordered: false, label: "", url: "", language: "", code: "" }),
  EditPanel: MarkdownEditPanel,
};
