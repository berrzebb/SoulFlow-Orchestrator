import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const URL_ACTIONS = ["parse", "build", "resolve", "encode", "decode", "query_params", "join", "normalize"] as const;
const NEEDS_URL2   = ["resolve"];
const NEEDS_PARAMS = ["build", "query_params"];
const NEEDS_PARTS  = ["build"];
const NEEDS_SEGS   = ["join"];

function UrlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {URL_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {!NEEDS_SEGS.includes(action) && (
        <BuilderField label={t("workflows.url")} required={!NEEDS_PARTS.includes(action)}>
          <input className="input" value={String(node.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="https://example.com/path?q=1" />
        </BuilderField>
      )}
      {NEEDS_URL2.includes(action) && (
        <BuilderField label={t("workflows.url_base")}>
          <input className="input" value={String(node.base || "")} onChange={(e) => update({ base: e.target.value })} placeholder="https://example.com" />
        </BuilderField>
      )}
      {NEEDS_PARTS.includes(action) && (
        <BuilderField label={t("workflows.url_parts")} hint={t("workflows.url_parts_hint")}>
          <textarea className="input" rows={3} value={String(node.parts || "")} onChange={(e) => update({ parts: e.target.value })} placeholder={'{"protocol":"https:","host":"example.com","pathname":"/api"}'} />
        </BuilderField>
      )}
      {NEEDS_PARAMS.includes(action) && (
        <BuilderField label={t("workflows.url_params")} hint={t("workflows.url_params_hint")}>
          <input className="input" value={String(node.params || "")} onChange={(e) => update({ params: e.target.value })} placeholder='{"key":"value"}' />
        </BuilderField>
      )}
      {NEEDS_SEGS.includes(action) && (
        <BuilderField label={t("workflows.url_segments")} hint={t("workflows.url_segments_hint")}>
          <input className="input" value={String(node.segments || "")} onChange={(e) => update({ segments: e.target.value })} placeholder='["api","v1","users"]' />
        </BuilderField>
      )}
      {(action === "encode" || action === "decode") && (
        <BuilderField label={t("workflows.url_component")}>
          <select className="input input--sm" value={String(node.component || "component")} onChange={(e) => update({ component: e.target.value })}>
            <option value="component">component</option>
            <option value="full">full</option>
          </select>
        </BuilderField>
      )}
    </>
  );
}

export const url_descriptor: FrontendNodeDescriptor = {
  node_type: "url",
  icon: "\u{1F517}",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.url.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.url.output.result" },
    { name: "query",  type: "object", description: "node.url.output.query" },
    { name: "path",   type: "string", description: "node.url.output.path" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.url.input.action" },
    { name: "url",    type: "string", description: "node.url.input.url" },
  ],
  create_default: () => ({ action: "parse", url: "", base: "", params: "", parts: "", segments: "", component: "component" }),
  EditPanel: UrlEditPanel,
};
