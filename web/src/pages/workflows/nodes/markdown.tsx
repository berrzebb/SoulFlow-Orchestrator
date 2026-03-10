import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function MarkdownEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "table");
  return (
    <>
      <BuilderField label={t("workflows.operation")}>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["table", "list", "checklist", "toc", "html_to_md", "badge", "link", "image", "code_block", "details", "task_list"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      {["table", "list", "checklist", "task_list"].includes(op) && (
        <BuilderField label={t("workflows.input_data")}>
          <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder={op === "table" ? '[{"name":"a","value":1}]' : '["item1","item2"]'} />
        </BuilderField>
      )}
      {op === "table" && (
        <>
          <BuilderField label={t("workflows.field_columns")}>
            <input className="input" value={String(node.columns || "")} onChange={(e) => update({ columns: e.target.value })} placeholder="name, value (auto-detect if empty)" />
          </BuilderField>
          <BuilderField label={t("workflows.markdown_align")}>
            <select className="input input--sm" value={String(node.align || "left")} onChange={(e) => update({ align: e.target.value })}>
              <option value="left">left</option>
              <option value="center">center</option>
              <option value="right">right</option>
            </select>
          </BuilderField>
        </>
      )}
      {["toc", "html_to_md", "details"].includes(op) && (
        <BuilderField label={t("workflows.field_text")}>
          <textarea className="input code-textarea" rows={4} value={String(node.text || "")} onChange={(e) => update({ text: e.target.value })} />
        </BuilderField>
      )}
      {op === "details" && (
        <BuilderField label={t("workflows.markdown_summary")}>
          <input className="input input--sm" value={String(node.summary || "")} onChange={(e) => update({ summary: e.target.value })} placeholder="Click to expand" />
        </BuilderField>
      )}
      {op === "code_block" && (
        <>
          <BuilderField label={t("workflows.field_language")}>
            <input className="input input--sm" value={String(node.language || "")} onChange={(e) => update({ language: e.target.value })} placeholder="javascript" />
          </BuilderField>
          <BuilderField label={t("workflows.field_code")}>
            <textarea className="input code-textarea" rows={4} value={String(node.code || "")} onChange={(e) => update({ code: e.target.value })} />
          </BuilderField>
        </>
      )}
      {["link", "badge", "image"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label={op === "image" ? t("workflows.field_alt") : t("workflows.field_label")}>
            <input className="input input--sm" value={String(node.label || node.alt || "")} onChange={(e) => update(op === "image" ? { alt: e.target.value } : { label: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_url")}>
            <input className="input input--sm" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "badge" && (
        <BuilderField label={t("workflows.markdown_badge_color")}>
          <input className="input input--sm" value={String(node.color || "")} onChange={(e) => update({ color: e.target.value })} placeholder="blue" />
        </BuilderField>
      )}
      {op === "list" && (
        <div className="builder-row">
          <label className="label-inline">
            <input type="checkbox" checked={Boolean(node.ordered)} onChange={(e) => update({ ordered: e.target.checked })} />
            {t("workflows.opt_ordered")}
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
  create_default: () => ({ operation: "table", data: "", text: "", columns: "", align: "left", ordered: false, label: "", alt: "", url: "", color: "", language: "", code: "", summary: "" }),
  EditPanel: MarkdownEditPanel,
};
