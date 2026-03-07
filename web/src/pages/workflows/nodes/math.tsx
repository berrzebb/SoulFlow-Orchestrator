import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function MathEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "eval");
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.operation")}</label>
        <select className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["eval", "convert", "compound_interest", "loan_payment", "roi", "percentage", "round", "gcd", "lcm", "factorial", "fibonacci"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {op === "eval" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_expression")}</label>
          <input className="input" value={String(node.expression || "")} onChange={(e) => update({ expression: e.target.value })} placeholder="Math.sqrt(144) + 2 * 3" />
        </div>
      )}
      {op === "convert" && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.field_value")}</label>
            <input className="input input--sm" type="number" value={String(node.value ?? 0)} onChange={(e) => update({ value: Number(e.target.value) })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_from_to")}</label>
            <div style={{ display: "flex", gap: "4px" }}>
              <input className="input input--sm" value={String(node.from || "")} onChange={(e) => update({ from: e.target.value })} placeholder="km" style={{ flex: 1 }} />
              <input className="input input--sm" value={String(node.to || "")} onChange={(e) => update({ to: e.target.value })} placeholder="mi" style={{ flex: 1 }} />
            </div>
          </div>
        </div>
      )}
      {["compound_interest", "loan_payment"].includes(op) && (
        <>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.field_principal")}</label>
              <input className="input input--sm" type="number" value={String(node.principal ?? 0)} onChange={(e) => update({ principal: Number(e.target.value) })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.field_rate")}</label>
              <input className="input input--sm" type="number" step="0.01" value={String(node.rate ?? 0)} onChange={(e) => update({ rate: Number(e.target.value) })} />
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_periods")}</label>
            <input className="input input--sm" type="number" value={String(node.periods ?? 0)} onChange={(e) => update({ periods: Number(e.target.value) })} />
          </div>
        </>
      )}
      {["round", "percentage"].includes(op) && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_value")}</label>
          <input className="input input--sm" type="number" value={String(node.value ?? 0)} onChange={(e) => update({ value: Number(e.target.value) })} />
        </div>
      )}
      {["gcd", "lcm"].includes(op) && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">A</label>
            <input className="input input--sm" type="number" value={String(node.a ?? 0)} onChange={(e) => update({ a: Number(e.target.value) })} />
          </div>
          <div className="builder-row">
            <label className="label">B</label>
            <input className="input input--sm" type="number" value={String(node.b ?? 0)} onChange={(e) => update({ b: Number(e.target.value) })} />
          </div>
        </div>
      )}
      {["factorial", "fibonacci"].includes(op) && (
        <div className="builder-row">
          <label className="label">N</label>
          <input className="input input--sm" type="number" min={0} value={String(node.n ?? 0)} onChange={(e) => update({ n: Number(e.target.value) })} />
        </div>
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
  create_default: () => ({ operation: "eval", expression: "", value: 0, from: "", to: "", principal: 0, rate: 0, periods: 0, a: 0, b: 0, n: 0, decimals: 2 }),
  EditPanel: MathEditPanel,
};
