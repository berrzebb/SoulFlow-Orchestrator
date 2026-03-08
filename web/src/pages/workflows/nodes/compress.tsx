import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

function CompressEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "compress");
  const is_file = op === "compress" || op === "decompress";
  return (
    <>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["compress", "decompress", "compress_string", "decompress_string"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_algorithm")}>
          <select className="input input--sm" value={String(node.algorithm || "gzip")} onChange={(e) => update({ algorithm: e.target.value })}>
            {["gzip", "brotli"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </div>
      {is_file && (
        <>
          <BuilderField label={t("workflows.field_input_path")}>
            <input className="input" value={String(node.input_path || "")} onChange={(e) => update({ input_path: e.target.value })} placeholder="/path/to/file" />
          </BuilderField>
          <BuilderField label={t("workflows.field_output_path")}>
            <input className="input" value={String(node.output_path || "")} onChange={(e) => update({ output_path: e.target.value })} placeholder="(auto)" />
          </BuilderField>
        </>
      )}
      {!is_file && (
        <BuilderField label={t("workflows.input_data")}>
          <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={op === "decompress_string" ? "base64 encoded..." : "text to compress"} />
        </BuilderField>
      )}
      <BuilderField label={t("workflows.field_level")} hint={t("workflows.compress_level_hint")}>
        <input className="input input--sm" type="number" min={1} max={11} value={String(node.level ?? 6)} onChange={(e) => update({ level: Number(e.target.value) })} />
      </BuilderField>
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
