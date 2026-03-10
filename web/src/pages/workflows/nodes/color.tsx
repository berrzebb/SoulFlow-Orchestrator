import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const COLOR_ACTIONS = ["parse", "convert", "blend", "contrast", "lighten", "darken", "palette", "complement"] as const;
const COLOR_FORMATS = ["hex", "rgb", "hsl"] as const;

function ColorEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  const needs_color2  = action === "blend" || action === "contrast";
  const needs_format  = action === "convert";
  const needs_amount  = action === "lighten" || action === "darken" || action === "blend";
  const needs_count   = action === "palette";
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {COLOR_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.color_value")} required>
        <BuilderRowPair>
          <input className="input" value={String(node.color || "")} onChange={(e) => update({ color: e.target.value })} placeholder="#3498db or rgb(52,152,219) or hsl(204,70%,53%)" />
          <input type="color" style={{ width: "40px", padding: "0", border: "none" }} value={String(node.color || "#3498db")} onChange={(e) => update({ color: e.target.value })} />
        </BuilderRowPair>
      </BuilderField>
      {needs_color2 && (
        <BuilderField label={t("workflows.color_value2")} required>
          <BuilderRowPair>
            <input className="input" value={String(node.color2 || "")} onChange={(e) => update({ color2: e.target.value })} placeholder="#ffffff" />
            <input type="color" style={{ width: "40px", padding: "0", border: "none" }} value={String(node.color2 || "#ffffff")} onChange={(e) => update({ color2: e.target.value })} />
          </BuilderRowPair>
        </BuilderField>
      )}
      {needs_format && (
        <BuilderField label={t("workflows.color_format")}>
          <select className="input input--sm" value={String(node.format || "hex")} onChange={(e) => update({ format: e.target.value })}>
            {COLOR_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </BuilderField>
      )}
      {needs_amount && (
        <BuilderField label={t("workflows.color_amount")} hint={t("workflows.color_amount_hint")}>
          <input className="input input--sm" type="number" min={0} max={1} step={0.05} value={String(node.amount ?? 0.2)} onChange={(e) => update({ amount: Number(e.target.value) })} />
        </BuilderField>
      )}
      {needs_count && (
        <BuilderField label={t("workflows.count")}>
          <input className="input input--sm" type="number" min={2} max={12} value={String(node.count ?? 5)} onChange={(e) => update({ count: Number(e.target.value) })} />
        </BuilderField>
      )}
    </>
  );
}

export const color_descriptor: FrontendNodeDescriptor = {
  node_type: "color",
  icon: "\u{1F3A8}",
  color: "#e64a19",
  shape: "rect",
  toolbar_label: "node.color.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string", description: "node.color.output.result" },
    { name: "hex",     type: "string", description: "node.color.output.hex" },
    { name: "rgb",     type: "array",  description: "node.color.output.rgb" },
    { name: "hsl",     type: "array",  description: "node.color.output.hsl" },
    { name: "palette", type: "array",  description: "node.color.output.palette" },
    { name: "ratio",   type: "number", description: "node.color.output.ratio" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.color.input.action" },
    { name: "color",  type: "string", description: "node.color.input.color" },
  ],
  create_default: () => ({ action: "parse", color: "#3498db", color2: "", format: "hex", amount: 0.2, count: 5 }),
  EditPanel: ColorEditPanel,
};
