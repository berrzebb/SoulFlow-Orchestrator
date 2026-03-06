import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function WebScrapeEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.scrape_url")}</label>
        <input className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/page" />
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
  toolbar_label: "+ Web Scrape",
  category: "integration",
  output_schema: [
    { name: "text",         type: "string", description: "Extracted text" },
    { name: "title",        type: "string", description: "Page title" },
    { name: "status",       type: "number", description: "HTTP status" },
    { name: "content_type", type: "string", description: "Content-Type" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "URL to scrape" },
    { name: "selector", type: "string", description: "CSS selector hint" },
  ],
  create_default: () => ({ url: "", selector: "", max_chars: 50000 }),
  EditPanel: WebScrapeEditPanel,
};
