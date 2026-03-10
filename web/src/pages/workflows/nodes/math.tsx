import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function MathEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "eval");
  return (
    <>
      <BuilderField label={t("workflows.operation")}>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["eval", "convert", "compound_interest", "loan_payment", "roi", "percentage", "round", "gcd", "lcm", "factorial", "fibonacci"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      {op === "eval" && (
        <BuilderField label={t("workflows.field_expression")}>
          <input className="input" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="Math.sqrt(144) + 2 * 3" />
        </BuilderField>
      )}
      {op === "convert" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_value")}>
            <input className="input input--sm" type="number" value={String(node.value ?? 0)} onChange={(e) => update({ value: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_from_to")}>
            <div style={{ display: "flex", gap: "4px" }}>
              <input className="input input--sm" value={String(node.from || "")} onChange={(e) => update({ from: e.target.value })} placeholder="km" style={{ flex: 1 }} />
              <input className="input input--sm" value={String(node.to || "")} onChange={(e) => update({ to: e.target.value })} placeholder="mi" style={{ flex: 1 }} />
            </div>
          </BuilderField>
        </BuilderRowPair>
      )}
      {["compound_interest", "loan_payment"].includes(op) && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.field_principal")}>
              <input className="input input--sm" type="number" value={String(node.principal ?? 0)} onChange={(e) => update({ principal: Number(e.target.value) })} />
            </BuilderField>
            <BuilderField label={t("workflows.field_rate")}>
              <input className="input input--sm" type="number" step="0.01" value={String(node.rate ?? 0)} onChange={(e) => update({ rate: Number(e.target.value) })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.field_periods")}>
            <input className="input input--sm" type="number" value={String(node.periods ?? 0)} onChange={(e) => update({ periods: Number(e.target.value) })} />
          </BuilderField>
        </>
      )}
      {op === "roi" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.math_cost")}>
            <input className="input input--sm" type="number" value={String(node.cost ?? 0)} onChange={(e) => update({ cost: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.math_gain")}>
            <input className="input input--sm" type="number" value={String(node.gain ?? 0)} onChange={(e) => update({ gain: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {["round", "percentage"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_value")}>
            <input className="input input--sm" type="number" value={String(node.value ?? 0)} onChange={(e) => update({ value: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_decimals")}>
            <input className="input input--sm" type="number" min={0} max={10} value={String(node.decimals ?? 2)} onChange={(e) => update({ decimals: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {["gcd", "lcm"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label="A">
            <input className="input input--sm" type="number" value={String(node.a ?? 0)} onChange={(e) => update({ a: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label="B">
            <input className="input input--sm" type="number" value={String(node.b ?? 0)} onChange={(e) => update({ b: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {["factorial", "fibonacci"].includes(op) && (
        <BuilderField label="N">
          <input className="input input--sm" type="number" min={0} value={String(node.n ?? 0)} onChange={(e) => update({ n: Number(e.target.value) })} />
        </BuilderField>
      )}
    </>
  );
}

export const math_descriptor: FrontendNodeDescriptor = {
  node_type: "math",
  icon: "\u{1F522}",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.math.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.math.output.result" },
    { name: "success", type: "boolean", description: "node.math.output.success" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.math.input.operation" },
    { name: "expression", type: "string", description: "node.math.input.expression" },
  ],
  create_default: () => ({ operation: "eval", expression: "", value: 0, from: "", to: "", principal: 0, rate: 0, periods: 0, cost: 0, gain: 0, a: 0, b: 0, n: 0, decimals: 2 }),
  EditPanel: MathEditPanel,
};
