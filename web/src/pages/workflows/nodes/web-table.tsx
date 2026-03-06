import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebTableEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.scrape_url")}</label>
        <input className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/data" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.selector")}</label>
          <input className="input input--sm" value={String(node.selector || "table")} onChange={(e) => update({ selector: e.target.value })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.max_results")}</label>
          <input className="input input--sm" type="number" min={1} max={1000} value={String(node.max_rows ?? 100)} onChange={(e) => update({ max_rows: Number(e.target.value) || 100 })} />
        </div>
      </div>
    </>
  );
}

export const web_table_descriptor: FrontendNodeDescriptor = {
  node_type: "web_table",
  icon: "\u{1F4CA}",
  color: "#0d47a1",
  shape: "rect",
  toolbar_label: "+ Web Table",
  category: "integration",
  output_schema: [
    { name: "headers", type: "array",  description: "Column headers" },
    { name: "rows",    type: "array",  description: "Row objects" },
    { name: "total",   type: "number", description: "Total rows" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "Target URL" },
    { name: "selector", type: "string", description: "Table CSS selector" },
  ],
  create_default: () => ({ url: "", selector: "table", max_rows: 100 }),
  EditPanel: WebTableEditPanel,
};
