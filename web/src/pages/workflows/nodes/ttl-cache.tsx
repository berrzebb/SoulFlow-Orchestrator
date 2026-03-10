import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function TtlCacheEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "get");
  return (
    <>
      {["set", "get", "invalidate", "has"].includes(op) ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.operation")}>
            <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
              {["set", "get", "invalidate", "has", "keys", "stats", "clear"].map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.field_key")}>
            <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="cache-key" />
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.operation")}>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["set", "get", "invalidate", "has", "keys", "stats", "clear"].map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
          </select>
        </BuilderField>
      )}
      {op === "set" && (
        <>
          <BuilderField label={t("workflows.field_value")}>
            <textarea className="input code-textarea" rows={2} value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_ttl_ms")}>
            <input className="input input--sm" type="number" min={1000} max={86400000} step={1000} value={String(node.ttl_ms ?? 300000)} onChange={(e) => update({ ttl_ms: Number(e.target.value) || 300000 })} />
          </BuilderField>
        </>
      )}
    </>
  );
}

export const ttl_cache_descriptor: FrontendNodeDescriptor = {
  node_type: "ttl_cache",
  icon: "\u{26A1}",
  color: "#ff6f00",
  shape: "rect",
  toolbar_label: "node.ttl_cache.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.ttl_cache.output.result" },
    { name: "success", type: "boolean", description: "node.ttl_cache.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.ttl_cache.input.operation" },
    { name: "key",       type: "string", description: "node.ttl_cache.input.key" },
  ],
  create_default: () => ({ operation: "get", key: "", value: "", ttl_ms: 300000 }),
  EditPanel: TtlCacheEditPanel,
};
