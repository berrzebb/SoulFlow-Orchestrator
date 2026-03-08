import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function WebTableEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.scrape_url")}>
        <input autoFocus className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/data" />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.selector")}>
          <input className="input input--sm" value={String(node.selector || "table")} onChange={(e) => update({ selector: e.target.value })} />
        </BuilderField>
        <BuilderField label={t("workflows.max_results")}>
          <input className="input input--sm" type="number" min={1} max={1000} value={String(node.max_rows ?? 100)} onChange={(e) => update({ max_rows: Number(e.target.value) || 100 })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const web_table_descriptor: FrontendNodeDescriptor = {
  node_type: "web_table",
  icon: "\u{1F4CA}",
  color: "#0d47a1",
  shape: "rect",
  toolbar_label: "node.web_table.label",
  category: "integration",
  output_schema: [
    { name: "headers", type: "array",  description: "node.web_table.output.headers" },
    { name: "rows",    type: "array",  description: "node.web_table.output.rows" },
    { name: "total",   type: "number", description: "node.web_table.output.total" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "node.web_table.input.url" },
    { name: "selector", type: "string", description: "node.web_table.input.selector" },
  ],
  create_default: () => ({ url: "", selector: "table", max_rows: 100 }),
  EditPanel: WebTableEditPanel,
};
