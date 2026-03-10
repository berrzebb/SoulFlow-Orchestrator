import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const PAGINATION_ACTIONS = ["offset", "cursor", "keyset", "calculate", "generate_links", "parse_link_header"] as const;

function PaginationEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "offset");
  const is_offset = action === "offset" || action === "calculate";
  const is_cursor = action === "cursor";
  const is_keyset = action === "keyset";
  const is_links  = action === "generate_links";
  const is_parse  = action === "parse_link_header";
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {PAGINATION_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {(is_offset || is_links) && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.pagination_page")}>
            <input className="input input--sm" type="number" min={1} value={String(node.page ?? 1)} onChange={(e) => update({ page: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.pagination_per_page")}>
            <input className="input input--sm" type="number" min={1} value={String(node.per_page ?? 20)} onChange={(e) => update({ per_page: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {is_offset && (
        <BuilderField label={t("workflows.pagination_total")}>
          <input className="input input--sm" type="number" min={0} value={String(node.total ?? 0)} onChange={(e) => update({ total: Number(e.target.value) })} />
        </BuilderField>
      )}
      {is_cursor && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.pagination_cursor")}>
              <input className="input input--sm" value={String(node.cursor || "")} onChange={(e) => update({ cursor: e.target.value })} placeholder="eyJ..." />
            </BuilderField>
            <BuilderField label={t("workflows.pagination_per_page")}>
              <input className="input input--sm" type="number" min={1} value={String(node.per_page ?? 20)} onChange={(e) => update({ per_page: Number(e.target.value) })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderRowPair>
            <BuilderField label={t("workflows.pagination_next_cursor")}>
              <input className="input input--sm" value={String(node.next_cursor || "")} onChange={(e) => update({ next_cursor: e.target.value })} placeholder="eyJ..." />
            </BuilderField>
            <BuilderField label={t("workflows.pagination_prev_cursor")}>
              <input className="input input--sm" value={String(node.prev_cursor || "")} onChange={(e) => update({ prev_cursor: e.target.value })} placeholder="eyJ..." />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
      {is_keyset && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.pagination_sort_key")}>
            <input className="input input--sm" value={String(node.sort_key || "id")} onChange={(e) => update({ sort_key: e.target.value })} placeholder="id" />
          </BuilderField>
          <BuilderField label={t("workflows.pagination_last_value")}>
            <input className="input input--sm" value={String(node.last_value || "")} onChange={(e) => update({ last_value: e.target.value })} placeholder="1024" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {is_links && (
        <BuilderField label={t("workflows.pagination_base_url")} required>
          <input className="input input--sm" value={String(node.base_url || "")} onChange={(e) => update({ base_url: e.target.value })} placeholder="https://api.example.com/items" />
        </BuilderField>
      )}
      {is_parse && (
        <BuilderField label={t("workflows.pagination_header")} required hint={t("workflows.pagination_header_hint")}>
          <input className="input" value={String(node.header || "")} onChange={(e) => update({ header: e.target.value })} placeholder='<https://api.example.com?page=2>; rel="next"' />
        </BuilderField>
      )}
    </>
  );
}

export const pagination_descriptor: FrontendNodeDescriptor = {
  node_type: "pagination",
  icon: "\u{1F4C4}",
  color: "#0277bd",
  shape: "rect",
  toolbar_label: "node.pagination.label",
  category: "data",
  output_schema: [
    { name: "page",        type: "number",  description: "node.pagination.output.page" },
    { name: "per_page",    type: "number",  description: "node.pagination.output.per_page" },
    { name: "total_pages", type: "number",  description: "node.pagination.output.total_pages" },
    { name: "offset",      type: "number",  description: "node.pagination.output.offset" },
    { name: "has_next",    type: "boolean", description: "node.pagination.output.has_next" },
    { name: "has_prev",    type: "boolean", description: "node.pagination.output.has_prev" },
  ],
  input_schema: [
    { name: "action",   type: "string", description: "node.pagination.input.action" },
    { name: "page",     type: "number", description: "node.pagination.input.page" },
    { name: "per_page", type: "number", description: "node.pagination.input.per_page" },
    { name: "total",    type: "number", description: "node.pagination.input.total" },
  ],
  create_default: () => ({
    action: "offset", page: 1, per_page: 20, total: 0,
    cursor: "", next_cursor: "", prev_cursor: "", has_more: false,
    sort_key: "id", last_value: "", base_url: "", header: "",
  }),
  EditPanel: PaginationEditPanel,
};
