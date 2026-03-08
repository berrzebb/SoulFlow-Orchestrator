import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CacheEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "get_or_set");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.cache_operation")}<span className="label__required">*</span></label>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          <option value="get_or_set">{t("workflows.cache_op_get_or_set")}</option>
          <option value="invalidate">{t("workflows.cache_op_invalidate")}</option>
        </select>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.cache_key")}</label>
        <input className="input input--sm" value={String(node.cache_key || "")} onChange={(e) => update({ cache_key: e.target.value })} placeholder="llm_{{memory.prompt_hash}}" />
        <span className="builder-hint">{t("workflows.cache_key_hint")}</span>
      </div>
      {op === "get_or_set" && (
        <div className="builder-row">
          <label className="label">{t("workflows.cache_ttl")}</label>
          <input className="input input--sm" type="number" min={0} value={String(node.ttl_ms ?? 300000)} onChange={(e) => update({ ttl_ms: Number(e.target.value) })} />
          <span className="builder-hint">{t("workflows.cache_ttl_hint")}</span>
        </div>
      )}
    </>
  );
}

export const cache_descriptor: FrontendNodeDescriptor = {
  node_type: "cache",
  icon: "💾",
  color: "#00bcd4",
  shape: "rect",
  toolbar_label: "node.cache.label",
  category: "data",
  output_schema: [
    { name: "value",     type: "unknown", description: "node.cache.output.value" },
    { name: "hit",       type: "boolean", description: "node.cache.output.hit" },
    { name: "cache_key", type: "string",  description: "node.cache.output.cache_key" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "node.cache.input.value" },
  ],
  create_default: () => ({ cache_key: "", ttl_ms: 300000, operation: "get_or_set" }),
  EditPanel: CacheEditPanel,
};
