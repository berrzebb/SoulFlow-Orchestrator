import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function ImageEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "info");
  return (
    <>
      {op === "convert" ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.operation")} required>
            <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
              {["resize", "crop", "rotate", "convert", "info", "thumbnail"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.format")}>
            <select className="input input--sm" value={String(node.format || "png")} onChange={(e) => update({ format: e.target.value })}>
              {["png", "jpeg", "webp", "gif", "bmp", "tiff"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["resize", "crop", "rotate", "convert", "info", "thumbnail"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
      )}
      <BuilderField label={t("workflows.field_input_path")}>
        <input className="input" value={String(node.input_path || "")} onChange={(e) => update({ input_path: e.target.value })} placeholder="/path/to/image.png" />
      </BuilderField>
      <BuilderField label={t("workflows.field_output_path")}>
        <input className="input" value={String(node.output_path || "")} onChange={(e) => update({ output_path: e.target.value })} placeholder="(auto)" />
      </BuilderField>
      {["resize", "crop", "thumbnail"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_width")}>
            <input className="input input--sm" type="number" min={1} max={10000} value={String(node.width ?? 800)} onChange={(e) => update({ width: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_height")}>
            <input className="input input--sm" type="number" min={1} max={10000} value={String(node.height ?? 600)} onChange={(e) => update({ height: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "rotate" && (
        <BuilderField label={t("workflows.field_angle")}>
          <input className="input input--sm" type="number" value={String(node.angle ?? 90)} onChange={(e) => update({ angle: Number(e.target.value) })} />
        </BuilderField>
      )}
      {op === "crop" && (
        <BuilderField label={t("workflows.image_gravity")}>
          <select className="input input--sm" value={String(node.gravity || "center")} onChange={(e) => update({ gravity: e.target.value })}>
            {["center", "north", "south", "east", "west", "northwest", "northeast", "southwest", "southeast"].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </BuilderField>
      )}
      {(op === "convert" || op === "thumbnail") && (
        <BuilderField label={t("workflows.image_quality")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.quality ?? 85)} onChange={(e) => update({ quality: Number(e.target.value) || 85 })} />
        </BuilderField>
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
