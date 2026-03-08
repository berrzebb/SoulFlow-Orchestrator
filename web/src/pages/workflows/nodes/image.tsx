import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ImageEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "info");
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.operation")}</label>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["resize", "crop", "rotate", "convert", "info", "thumbnail"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {op === "convert" && (
          <div className="builder-row">
            <label className="label">{t("workflows.format")}</label>
            <select className="input input--sm" value={String(node.format || "png")} onChange={(e) => update({ format: e.target.value })}>
              {["png", "jpeg", "webp", "gif", "bmp", "tiff"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_input_path")}</label>
        <input className="input" value={String(node.input_path || "")} onChange={(e) => update({ input_path: e.target.value })} placeholder="/path/to/image.png" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.field_output_path")}</label>
        <input className="input" value={String(node.output_path || "")} onChange={(e) => update({ output_path: e.target.value })} placeholder="(auto)" />
      </div>
      {["resize", "crop", "thumbnail"].includes(op) && (
        <div className="builder-row-pair">
          <div className="builder-row">
            <label className="label">{t("workflows.field_width")}</label>
            <input className="input input--sm" type="number" min={1} max={10000} value={String(node.width ?? 800)} onChange={(e) => update({ width: Number(e.target.value) })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_height")}</label>
            <input className="input input--sm" type="number" min={1} max={10000} value={String(node.height ?? 600)} onChange={(e) => update({ height: Number(e.target.value) })} />
          </div>
        </div>
      )}
      {op === "rotate" && (
        <div className="builder-row">
          <label className="label">{t("workflows.field_angle")}</label>
          <input className="input input--sm" type="number" value={String(node.angle ?? 90)} onChange={(e) => update({ angle: Number(e.target.value) })} />
        </div>
      )}
    </>
  );
}

export const image_descriptor: FrontendNodeDescriptor = {
  node_type: "image",
  icon: "\u{1F5BC}",
  color: "#d81b60",
  shape: "rect",
  toolbar_label: "node.image.label",
  category: "integration",
  output_schema: [
    { name: "result",  type: "string",  description: "node.image.output.result" },
    { name: "success", type: "boolean", description: "node.image.output.success" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.image.input.operation" },
    { name: "input_path", type: "string", description: "node.image.input.input_path" },
  ],
  create_default: () => ({ operation: "info", input_path: "", output_path: "", width: 800, height: 600, format: "png", quality: 85, angle: 90 }),
  EditPanel: ImageEditPanel,
};
