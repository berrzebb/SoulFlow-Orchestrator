import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function EncodingEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "encode");
  return (
    <>
      <div className="builder-row-pair">
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["encode", "decode", "hash", "uuid"].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
        {op !== "uuid" && (
          <BuilderField label={t("workflows.format")}>
            <select className="input input--sm" value={String(node.format || "base64")} onChange={(e) => update({ format: e.target.value })}>
              {op === "hash"
                ? ["sha256", "sha512", "md5"].map((f) => <option key={f} value={f}>{f}</option>)
                : ["base64", "hex", "url"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </BuilderField>
        )}
      </div>
      {op !== "uuid" && (
        <BuilderField label={t("workflows.input_data")}>
          <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="Hello World" />
        </BuilderField>
      )}
      {op === "uuid" && (
        <BuilderField label={t("workflows.field_count")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.count ?? 1)} onChange={(e) => update({ count: Number(e.target.value) || 1 })} />
        </BuilderField>
      )}
    </>
  );
}

export const encoding_descriptor: FrontendNodeDescriptor = {
  node_type: "encoding",
  icon: "\u{1F510}",
  color: "#4527a0",
  shape: "rect",
  toolbar_label: "node.encoding.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.encoding.output.result" },
    { name: "success", type: "boolean", description: "node.encoding.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.encoding.input.operation" },
    { name: "input",     type: "string", description: "node.encoding.input.input" },
    { name: "format",    type: "string", description: "node.encoding.input.format" },
  ],
  create_default: () => ({ operation: "encode", input: "", format: "base64", count: 1 }),
  EditPanel: EncodingEditPanel,
};
