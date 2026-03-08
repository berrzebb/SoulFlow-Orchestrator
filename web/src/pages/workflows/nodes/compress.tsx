import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function CompressEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "compress");
  const is_file = op === "compress" || op === "decompress";
  return (
    <>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.operation")}</label>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["compress", "decompress", "compress_string", "decompress_string"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.field_algorithm")}</label>
          <select className="input input--sm" value={String(node.algorithm || "gzip")} onChange={(e) => update({ algorithm: e.target.value })}>
            {["gzip", "brotli"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      {is_file && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.field_input_path")}</label>
            <input className="input" value={String(node.input_path || "")} onChange={(e) => update({ input_path: e.target.value })} placeholder="/path/to/file" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.field_output_path")}</label>
            <input className="input" value={String(node.output_path || "")} onChange={(e) => update({ output_path: e.target.value })} placeholder="(auto)" />
          </div>
        </>
      )}
      {!is_file && (
        <div className="builder-row">
          <label className="label">{t("workflows.input_data")}</label>
          <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={op === "decompress_string" ? "base64 encoded..." : "text to compress"} />
        </div>
      )}
      <div className="builder-row">
        <label className="label">{t("workflows.field_level")}</label>
        <input className="input input--sm" type="number" min={1} max={11} value={String(node.level ?? 6)} onChange={(e) => update({ level: Number(e.target.value) })} />
        <span className="builder-hint">{t("workflows.compress_level_hint")}</span>
      </div>
    </>
  );
}

export const compress_descriptor: FrontendNodeDescriptor = {
  node_type: "compress",
  icon: "\u{1F4E6}",
  color: "#558b2f",
  shape: "rect",
  toolbar_label: "node.compress.label",
  category: "integration",
  output_schema: [
    { name: "result",  type: "string",  description: "node.compress.output.result" },
    { name: "success", type: "boolean", description: "node.compress.output.success" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.compress.input.operation" },
    { name: "input_path", type: "string", description: "node.compress.input.input_path" },
  ],
  create_default: () => ({ operation: "compress", input_path: "", output_path: "", input: "", algorithm: "gzip", level: 6 }),
  EditPanel: CompressEditPanel,
};
