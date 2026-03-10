import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const BASES = ["bin", "oct", "dec", "hex", "base32", "base36", "base62"];
const ALL_OPS = ["encode", "decode", "hash", "uuid", "base_convert", "msgpack_encode", "msgpack_decode", "protobuf_define", "protobuf_encode", "protobuf_decode", "protobuf_to_proto"];

function EncodingEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "encode");
  const isCharEncoding = op === "encode" || op === "decode" || op === "hash";
  const isProtobuf = op.startsWith("protobuf_");

  return (
    <>
      {isCharEncoding ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.operation")} required>
            <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
              {ALL_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.format")}>
            <select className="input input--sm" value={String(node.format || "base64")} onChange={(e) => update({ format: e.target.value })}>
              {op === "hash"
                ? ["sha256", "sha512", "md5"].map((f) => <option key={f} value={f}>{f}</option>)
                : ["base64", "hex", "url"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      ) : op === "base_convert" ? (
        <>
          <BuilderField label={t("workflows.operation")} required>
            <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
              {ALL_OPS.map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
            </select>
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.encoding_base_from")}>
              <select className="input input--sm" value={String(node.base_from || "dec")} onChange={(e) => update({ base_from: e.target.value })}>
                {BASES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.encoding_base_to")}>
              <select className="input input--sm" value={String(node.base_to || "hex")} onChange={(e) => update({ base_to: e.target.value })}>
                {BASES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </BuilderField>
          </BuilderRowPair>
        </>
      ) : (
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {ALL_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </BuilderField>
      )}
      {isProtobuf && (
        <BuilderField label={t("workflows.encoding_protobuf_schema")} hint={t("workflows.encoding_protobuf_schema_hint")}>
          <textarea className="input code-textarea" rows={4} value={String(node.schema || "")} onChange={(e) => update({ schema: e.target.value })} placeholder='{"name":"Person","fields":[{"number":1,"name":"name","type":"string"}]}' />
        </BuilderField>
      )}
      {op !== "uuid" && (
        <BuilderField label={t("workflows.input_data")}>
          <textarea
            className="input code-textarea"
            rows={3}
            value={String(node.input || "")}
            onChange={(e) => update({ input: e.target.value })}
            placeholder={
              op === "msgpack_encode" || op === "protobuf_encode" ? '{"name": "Alice"}'
              : op === "msgpack_decode" || op === "protobuf_decode" ? "hex bytes..."
              : op === "base_convert" ? "255"
              : op === "protobuf_define" || op === "protobuf_to_proto" ? t("node.encoding.schema_above_hint")
              : "Hello World"
            }
            disabled={op === "protobuf_define" || op === "protobuf_to_proto"}
          />
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
  create_default: () => ({ operation: "encode", input: "", format: "base64", count: 1, base_from: "dec", base_to: "hex", schema: "" }),
  EditPanel: EncodingEditPanel,
};
