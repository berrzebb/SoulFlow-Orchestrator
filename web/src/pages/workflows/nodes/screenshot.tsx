import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ScreenshotEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.scrape_url")}</label>
        <input className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.field_width")}</label>
          <input className="input input--sm" type="number" min={320} max={3840} value={String(node.width ?? 1280)} onChange={(e) => update({ width: Number(e.target.value) || 1280 })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.field_height")}</label>
          <input className="input input--sm" type="number" min={240} max={2160} value={String(node.height ?? 720)} onChange={(e) => update({ height: Number(e.target.value) || 720 })} />
        </div>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.selector")}</label>
          <input className="input input--sm" value={String(node.selector || "")} onChange={(e) => update({ selector: e.target.value })} placeholder="#main-content" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.field_delay_ms")}</label>
          <input className="input input--sm" type="number" min={0} max={10000} step={500} value={String(node.delay_ms ?? 1000)} onChange={(e) => update({ delay_ms: Number(e.target.value) || 1000 })} />
        </div>
      </div>
      <div className="builder-row">
        <label className="label">
          <input type="checkbox" checked={Boolean(node.full_page)} onChange={(e) => update({ full_page: e.target.checked })} />
          {" "}{t("workflows.full_page")}
        </label>
      </div>
    </>
  );
}

export const screenshot_descriptor: FrontendNodeDescriptor = {
  node_type: "screenshot",
  icon: "\u{1F4F7}",
  color: "#ad1457",
  shape: "rect",
  toolbar_label: "node.screenshot.label",
  category: "integration",
  output_schema: [
    { name: "output_path", type: "string",  description: "node.screenshot.output.output_path" },
    { name: "success",     type: "boolean", description: "node.screenshot.output.success" },
  ],
  input_schema: [
    { name: "url",      type: "string", description: "node.screenshot.input.url" },
    { name: "selector", type: "string", description: "node.screenshot.input.selector" },
  ],
  create_default: () => ({ url: "", output_path: "", selector: "", full_page: false, width: 1280, height: 720, delay_ms: 1000 }),
  EditPanel: ScreenshotEditPanel,
};
