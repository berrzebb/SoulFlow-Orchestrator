import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const SVG_ACTIONS = ["chart", "viewBox", "rect", "circle", "line", "path", "text", "group", "to_data_uri"] as const;
const CHART_TYPES = ["bar", "line", "pie"] as const;
const PRIMITIVE_ACTIONS = ["rect", "circle", "line", "path", "text", "group"];

function SvgEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "chart");
  const is_primitive = PRIMITIVE_ACTIONS.includes(action);
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {SVG_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>

      {action === "chart" && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.svg_chart_type")}>
              <select className="input input--sm" value={String(node.chart_type || "bar")} onChange={(e) => update({ chart_type: e.target.value })}>
                {CHART_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.svg_title")}>
              <input className="input input--sm" value={String(node.chart_title || "")} onChange={(e) => update({ chart_title: e.target.value })} placeholder="My Chart" />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.svg_chart_data")} required hint={t("workflows.svg_chart_data_hint")}>
            <textarea className="input code-textarea" rows={3} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder='[{"label":"A","value":10},{"label":"B","value":20}]' />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.svg_width")}>
              <input className="input input--sm" type="number" min={100} value={String(node.width ?? 400)} onChange={(e) => update({ width: Number(e.target.value) })} />
            </BuilderField>
            <BuilderField label={t("workflows.svg_height")}>
              <input className="input input--sm" type="number" min={100} value={String(node.height ?? 300)} onChange={(e) => update({ height: Number(e.target.value) })} />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}

      {action === "viewBox" && (
        <>
          <BuilderField label={t("workflows.svg_content")} hint={t("workflows.svg_content_hint")}>
            <textarea className="input code-textarea" rows={4} value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder="<rect x='10' y='10' width='80' height='80'/>" />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.svg_width")}>
              <input className="input input--sm" type="number" min={10} value={String(node.width ?? 400)} onChange={(e) => update({ width: Number(e.target.value) })} />
            </BuilderField>
            <BuilderField label={t("workflows.svg_height")}>
              <input className="input input--sm" type="number" min={10} value={String(node.height ?? 300)} onChange={(e) => update({ height: Number(e.target.value) })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.svg_view_box")}>
            <input className="input input--sm" value={String(node.view_box || "")} onChange={(e) => update({ view_box: e.target.value })} placeholder="0 0 400 300" />
          </BuilderField>
        </>
      )}

      {action === "to_data_uri" && (
        <BuilderField label={t("workflows.svg_input")} required>
          <textarea className="input code-textarea" rows={5} value={String(node.svg || "")} onChange={(e) => update({ svg: e.target.value })} placeholder="<svg ...>...</svg>" />
        </BuilderField>
      )}

      {action === "group" && (
        <BuilderField label={t("workflows.svg_children")} hint={t("workflows.svg_children_hint")}>
          <textarea className="input code-textarea" rows={4} value={String(node.children || "[]")} onChange={(e) => update({ children: e.target.value })} placeholder='["<rect ... />", "<circle ... />"]' />
        </BuilderField>
      )}

      {is_primitive && action !== "group" && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.svg_fill")}>
              <BuilderRowPair>
                <input className="input input--sm" value={String(node.fill || "#4A90D9")} onChange={(e) => update({ fill: e.target.value })} />
                <input type="color" style={{ width: "40px", padding: "0", border: "none" }} value={String(node.fill || "#4A90D9")} onChange={(e) => update({ fill: e.target.value })} />
              </BuilderRowPair>
            </BuilderField>
            <BuilderField label={t("workflows.svg_stroke")}>
              <input className="input input--sm" value={String(node.stroke || "")} onChange={(e) => update({ stroke: e.target.value })} placeholder="#333" />
            </BuilderField>
          </BuilderRowPair>
          {(action === "rect") && (
            <BuilderRowPair>
              <BuilderField label="x / y">
                <BuilderRowPair>
                  <input className="input input--sm" type="number" value={String(node.x ?? 0)} onChange={(e) => update({ x: Number(e.target.value) })} placeholder="x" />
                  <input className="input input--sm" type="number" value={String(node.y ?? 0)} onChange={(e) => update({ y: Number(e.target.value) })} placeholder="y" />
                </BuilderRowPair>
              </BuilderField>
              <BuilderField label="w / h">
                <BuilderRowPair>
                  <input className="input input--sm" type="number" value={String(node.width ?? 100)} onChange={(e) => update({ width: Number(e.target.value) })} placeholder="w" />
                  <input className="input input--sm" type="number" value={String(node.height ?? 100)} onChange={(e) => update({ height: Number(e.target.value) })} placeholder="h" />
                </BuilderRowPair>
              </BuilderField>
            </BuilderRowPair>
          )}
          {(action === "circle") && (
            <BuilderRowPair>
              <BuilderField label="cx / cy">
                <BuilderRowPair>
                  <input className="input input--sm" type="number" value={String(node.cx ?? 50)} onChange={(e) => update({ cx: Number(e.target.value) })} placeholder="cx" />
                  <input className="input input--sm" type="number" value={String(node.cy ?? 50)} onChange={(e) => update({ cy: Number(e.target.value) })} placeholder="cy" />
                </BuilderRowPair>
              </BuilderField>
              <BuilderField label="r">
                <input className="input input--sm" type="number" value={String(node.r ?? 40)} onChange={(e) => update({ r: Number(e.target.value) })} />
              </BuilderField>
            </BuilderRowPair>
          )}
          {(action === "line") && (
            <BuilderRowPair>
              <BuilderField label="x1 / y1">
                <BuilderRowPair>
                  <input className="input input--sm" type="number" value={String(node.x1 ?? 0)} onChange={(e) => update({ x1: Number(e.target.value) })} placeholder="x1" />
                  <input className="input input--sm" type="number" value={String(node.y1 ?? 0)} onChange={(e) => update({ y1: Number(e.target.value) })} placeholder="y1" />
                </BuilderRowPair>
              </BuilderField>
              <BuilderField label="x2 / y2">
                <BuilderRowPair>
                  <input className="input input--sm" type="number" value={String(node.x2 ?? 100)} onChange={(e) => update({ x2: Number(e.target.value) })} placeholder="x2" />
                  <input className="input input--sm" type="number" value={String(node.y2 ?? 100)} onChange={(e) => update({ y2: Number(e.target.value) })} placeholder="y2" />
                </BuilderRowPair>
              </BuilderField>
            </BuilderRowPair>
          )}
          {(action === "path") && (
            <BuilderField label={t("workflows.svg_path_d")} required>
              <input className="input" value={String(node.d || "")} onChange={(e) => update({ d: e.target.value })} placeholder="M0,0 L100,100 Z" />
            </BuilderField>
          )}
          {(action === "text") && (
            <>
              <BuilderField label={t("workflows.svg_content")} required>
                <input className="input" value={String(node.content || "")} onChange={(e) => update({ content: e.target.value })} placeholder="Hello SVG" />
              </BuilderField>
              <BuilderRowPair>
                <BuilderField label="x / y">
                  <BuilderRowPair>
                    <input className="input input--sm" type="number" value={String(node.x ?? 0)} onChange={(e) => update({ x: Number(e.target.value) })} placeholder="x" />
                    <input className="input input--sm" type="number" value={String(node.y ?? 20)} onChange={(e) => update({ y: Number(e.target.value) })} placeholder="y" />
                  </BuilderRowPair>
                </BuilderField>
                <BuilderField label={t("workflows.svg_font_size")}>
                  <input className="input input--sm" type="number" min={8} max={72} value={String(node.font_size ?? 14)} onChange={(e) => update({ font_size: Number(e.target.value) })} />
                </BuilderField>
              </BuilderRowPair>
            </>
          )}
        </>
      )}
    </>
  );
}

export const svg_descriptor: FrontendNodeDescriptor = {
  node_type: "svg",
  icon: "\u{1F5BC}",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.svg.label",
  category: "data",
  output_schema: [
    { name: "svg",      type: "string", description: "node.svg.output.svg" },
    { name: "data_uri", type: "string", description: "node.svg.output.data_uri" },
  ],
  input_schema: [
    { name: "action",     type: "string", description: "node.svg.input.action" },
    { name: "chart_type", type: "string", description: "node.svg.input.chart_type" },
    { name: "data",       type: "string", description: "node.svg.input.data" },
  ],
  create_default: () => ({
    action: "chart", chart_type: "bar", data: '[{"label":"A","value":10},{"label":"B","value":20}]',
    chart_title: "", width: 400, height: 300,
    x: 0, y: 0, cx: 50, cy: 50, r: 40,
    x1: 0, y1: 0, x2: 100, y2: 100,
    fill: "#4A90D9", stroke: "", stroke_width: 2,
    content: "", children: "[]", view_box: "", svg: "", d: "",
    font_size: 14,
  }),
  EditPanel: SvgEditPanel,
};
