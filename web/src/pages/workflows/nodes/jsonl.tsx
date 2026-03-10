import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const JSONL_ACTIONS = ["parse", "generate", "filter", "count", "head", "tail", "map", "unique"] as const;

function JsonlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {JSONL_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {action !== "generate" && (
        <BuilderField label={t("workflows.jsonl_input")} required>
          <textarea className="input" rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={'{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}'} />
        </BuilderField>
      )}
      {action === "generate" && (
        <BuilderField label={t("workflows.jsonl_data")} required hint={t("workflows.jsonl_data_hint")}>
          <textarea className="input" rows={4} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder='[{"id":1},{"id":2}]' />
        </BuilderField>
      )}
      {action === "filter" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.jsonl_field")} required>
            <input className="input input--sm" value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="status" />
          </BuilderField>
          <BuilderField label={t("workflows.jsonl_value")} required>
            <input className="input input--sm" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="active" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {(action === "head" || action === "tail") && (
        <BuilderField label={t("workflows.count")}>
          <input className="input input--sm" type="number" min={1} value={String(node.count ?? 10)} onChange={(e) => update({ count: Number(e.target.value) || 10 })} />
        </BuilderField>
      )}
      {(action === "map" || action === "unique") && (
        <BuilderField label={t("workflows.jsonl_field")} required>
          <input className="input input--sm" value={String(node.field || "")} onChange={(e) => update({ field: e.target.value })} placeholder="name" />
        </BuilderField>
      )}
    </>
  );
}

export const jsonl_descriptor: FrontendNodeDescriptor = {
  node_type: "jsonl",
  icon: "\u{1F4CA}",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.jsonl.label",
  category: "data",
  output_schema: [
    { name: "records", type: "array",  description: "node.jsonl.output.records" },
    { name: "count",   type: "number", description: "node.jsonl.output.count" },
    { name: "matched", type: "array",  description: "node.jsonl.output.matched" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.jsonl.input.action" },
    { name: "input",  type: "string", description: "node.jsonl.input.input" },
  ],
  create_default: () => ({ action: "parse", input: "", data: "", field: "", value: "", count: 10 }),
  EditPanel: JsonlEditPanel,
};
