import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["ping", "get", "set", "del", "keys", "hget", "hset", "lpush", "lrange", "expire", "ttl", "incr", "info"];

function RedisEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "ping");
  const needs_key = ["get", "set", "del", "hget", "hset", "lpush", "lrange", "expire", "ttl", "incr"].includes(action);
  const needs_value = ["set", "hset", "lpush"].includes(action);
  const needs_field = ["hget", "hset"].includes(action);
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.host")} required>
          <input className="input input--sm" required value={String(node.host || "localhost")} onChange={(e) => update({ host: e.target.value })} placeholder="localhost" aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.port")}>
          <input className="input input--sm" type="number" min={1} max={65535} value={String(node.port ?? 6379)} onChange={(e) => update({ port: Number(e.target.value) || 6379 })} />
        </BuilderField>
        <BuilderField label={t("workflows.password")}>
          <input className="input input--sm" type="password" value={String(node.password || "")} onChange={(e) => update({ password: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
      {needs_key && (
        <BuilderField label={t("workflows.key")} required>
          <input className="input input--sm" required value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="my:key" aria-required="true" />
        </BuilderField>
      )}
      {needs_field && (
        <BuilderField label={t("workflows.field")} required>
          <input className="input input--sm" required value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="field" aria-required="true" />
        </BuilderField>
      )}
      {needs_value && (
        <BuilderField label={t("workflows.value")} required>
          <input className="input input--sm" required value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="value" aria-required="true" />
        </BuilderField>
      )}
      {action === "keys" && (
        <BuilderField label={t("workflows.pattern")}>
          <input className="input input--sm" value={String(node.pattern || "*")} onChange={(e) => update({ pattern: e.target.value })} placeholder="*" />
        </BuilderField>
      )}
      {action === "set" && (
        <BuilderField label={t("workflows.ttl")}>
          <input className="input input--sm" type="number" min={0} value={String(node.ttl ?? "")} onChange={(e) => update({ ttl: e.target.value ? Number(e.target.value) : undefined })} placeholder="seconds (optional)" />
        </BuilderField>
      )}
    </>
  );
}

export const redis_descriptor: FrontendNodeDescriptor = {
  node_type: "redis",
  icon: "🔴",
  color: "#dc382d",
  shape: "rect",
  toolbar_label: "node.redis.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.redis.output.result" },
    { name: "success", type: "boolean", description: "node.redis.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.redis.input.action" },
    { name: "host", type: "string", description: "node.redis.input.host" },
    { name: "key", type: "string", description: "node.redis.input.key" },
  ],
  create_default: () => ({ action: "ping", host: "localhost", port: 6379, password: "", key: "", value: "" }),
  EditPanel: RedisEditPanel,
};
