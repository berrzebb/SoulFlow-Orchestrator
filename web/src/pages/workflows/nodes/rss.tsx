import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "add_item", "fetch_parse"];

function RssEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "fetch_parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {action === "fetch_parse" && (
        <BuilderField label={t("workflows.field_url")} required>
          <input className="input input--sm" required value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/feed.rss" aria-required="true" />
        </BuilderField>
      )}
      {(action === "parse" || action === "add_item") && (
        <BuilderField label={t("workflows.rss_input_xml")} required>
          <textarea className="input" required rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="<rss>...</rss>" aria-required="true" />
        </BuilderField>
      )}
      {(action === "generate" || action === "add_item") && (
        <>
          <BuilderField label={t("workflows.field_title")} required>
            <input className="input input--sm" required value={String(node.feed_title || "")} onChange={(e) => update({ feed_title: e.target.value })} placeholder="My Feed" aria-required="true" />
          </BuilderField>
          <BuilderField label={t("workflows.field_link")} required>
            <input className="input input--sm" required value={String(node.link || "")} onChange={(e) => update({ link: e.target.value })} placeholder="https://example.com" aria-required="true" />
          </BuilderField>
        </>
      )}
      {action === "generate" && (
        <BuilderField label={t("workflows.rss_items_json")}>
          <textarea className="input" rows={3} value={String(node.items || "")} onChange={(e) => update({ items: e.target.value })} placeholder='[{"title":"...","link":"..."}]' />
        </BuilderField>
      )}
    </>
  );
}

export const rss_descriptor: FrontendNodeDescriptor = {
  node_type: "rss",
  icon: "📡",
  color: "#ee802f",
  shape: "rect",
  toolbar_label: "node.rss.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.rss.output.result" },
    { name: "success", type: "boolean", description: "node.rss.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.rss.input.action" },
    { name: "url", type: "string", description: "node.rss.input.url" },
  ],
  create_default: () => ({ action: "fetch_parse", url: "", input: "", feed_title: "", link: "" }),
  EditPanel: RssEditPanel,
};
