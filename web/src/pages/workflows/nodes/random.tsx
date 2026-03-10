import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const RANDOM_ACTIONS = ["integer", "float", "choice", "shuffle", "sample", "password", "bytes", "coin", "dice"] as const;
const CHARSETS = ["alphanumeric", "symbols", "hex", "numeric"] as const;

function RandomEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "integer");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {RANDOM_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {(action === "integer" || action === "float") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.random_min")}>
            <input className="input input--sm" type="number" value={String(node.min ?? 0)} onChange={(e) => update({ min: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.random_max")}>
            <input className="input input--sm" type="number" value={String(node.max ?? 100)} onChange={(e) => update({ max: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {(action === "choice" || action === "shuffle" || action === "sample") && (
        <BuilderField label={t("workflows.random_items")} hint={t("workflows.random_items_hint")}>
          <input className="input" value={String(node.items || "")} onChange={(e) => update({ items: e.target.value })} placeholder='["apple","banana","cherry"] or apple,banana,cherry' />
        </BuilderField>
      )}
      {action === "sample" && (
        <BuilderField label={t("workflows.count")}>
          <input className="input input--sm" type="number" min={1} value={String(node.count ?? 1)} onChange={(e) => update({ count: Number(e.target.value) })} />
        </BuilderField>
      )}
      {action === "password" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.random_length")}>
            <input className="input input--sm" type="number" min={4} max={128} value={String(node.length ?? 16)} onChange={(e) => update({ length: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.random_charset")}>
            <select className="input input--sm" value={String(node.charset || "symbols")} onChange={(e) => update({ charset: e.target.value })}>
              {CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      )}
      {action === "bytes" && (
        <BuilderField label={t("workflows.count")}>
          <input className="input input--sm" type="number" min={1} max={1024} value={String(node.count ?? 16)} onChange={(e) => update({ count: Number(e.target.value) })} />
        </BuilderField>
      )}
      {action === "dice" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.random_sides")}>
            <input className="input input--sm" type="number" min={2} max={100} value={String(node.sides ?? 6)} onChange={(e) => update({ sides: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.count")}>
            <input className="input input--sm" type="number" min={1} max={100} value={String(node.count ?? 1)} onChange={(e) => update({ count: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const random_descriptor: FrontendNodeDescriptor = {
  node_type: "random",
  icon: "\u{1F3B2}",
  color: "#7b1fa2",
  shape: "rect",
  toolbar_label: "node.random.label",
  category: "data",
  output_schema: [
    { name: "value",    type: "string", description: "node.random.output.value" },
    { name: "result",   type: "array",  description: "node.random.output.result" },
    { name: "password", type: "string", description: "node.random.output.password" },
    { name: "rolls",    type: "array",  description: "node.random.output.rolls" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.random.input.action" },
    { name: "items",  type: "string", description: "node.random.input.items" },
  ],
  create_default: () => ({ action: "integer", min: 0, max: 100, items: "", count: 1, length: 16, charset: "symbols", sides: 6 }),
  EditPanel: RandomEditPanel,
};
