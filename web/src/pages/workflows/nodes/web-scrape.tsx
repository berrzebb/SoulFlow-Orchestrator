import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebScrapeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.scrape_url")}</label>
        <input autoFocus className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/page" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.selector")}</label>
          <input className="input input--sm" value={String(node.selector || "")} onChange={(e) => update({ selector: e.target.value })} placeholder="article, .content" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.max_chars")}</label>
          <input className="input input--sm" type="number" min={1000} max={100000} step={1000} value={String(node.max_chars ?? 50000)} onChange={(e) => update({ max_chars: Number(e.target.value) || 50000 })} />
        </div>
      </div>
    </>
  );
}

export const web_scrape_descriptor: FrontendNodeDescriptor = {
  node_type: "web_scrape",
  icon: "\u{1F578}",
  color: "#e67e22",
  shape: "rect",
  toolbar_label: "node.web_scrape.label",
  category: "integration",
  output_schema: [
    { name: "text",         type: "string", description: "node.web_scrape.output.text" },
    { name: "title",        type: "string", description: "node.web_scrape.output.title" },
    { name: "status",       type: "number", description: "node.web_scrape.output.status" },
    { name: "content_type", type: "string", description: "node.web_scrape.output.content_type" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "node.web_scrape.input.url" },
    { name: "selector", type: "string", description: "node.web_scrape.input.selector" },
  ],
  create_default: () => ({ url: "", selector: "", max_chars: 50000 }),
  EditPanel: WebScrapeEditPanel,
};
