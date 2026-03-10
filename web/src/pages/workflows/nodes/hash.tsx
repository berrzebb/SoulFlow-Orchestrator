import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["hash", "hmac", "verify", "crc32", "adler32"];
const ALGORITHMS = ["md5", "sha1", "sha256", "sha384", "sha512"];
const ENCODINGS = ["hex", "base64", "base64url"];

function HashEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "hash");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_input")} required>
        <input className="input input--sm" required value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder={t("node.hash.input_placeholder")} aria-required="true" />
      </BuilderField>
      {action !== "crc32" && action !== "adler32" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_algorithm")}>
            <select className="input input--sm" value={String(node.algorithm || "sha256")} onChange={(e) => update({ algorithm: e.target.value })}>
              {ALGORITHMS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.hash_encoding")}>
            <select className="input input--sm" value={String(node.encoding || "hex")} onChange={(e) => update({ encoding: e.target.value })}>
              {ENCODINGS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      )}
      {(action === "hmac" || action === "verify") && (
        <BuilderField label={t("workflows.field_key")} required={action === "hmac"}>
          <input className="input input--sm" required={action === "hmac"} value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="HMAC secret key" aria-required={action === "hmac" ? "true" : undefined} />
        </BuilderField>
      )}
      {action === "verify" && (
        <BuilderField label={t("workflows.hash_expected")} required>
          <input className="input input--sm" required value={String(node.expected || "")} onChange={(e) => update({ expected: e.target.value })} placeholder="Expected hash value" aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const hash_descriptor: FrontendNodeDescriptor = {
  node_type: "hash",
  icon: "🔒",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.hash.label",
  category: "data",
  output_schema: [
    { name: "digest", type: "string", description: "node.hash.output.digest" },
    { name: "success", type: "boolean", description: "node.hash.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.hash.input.action" },
    { name: "input", type: "string", description: "node.hash.input.input" },
    { name: "algorithm", type: "string", description: "node.hash.input.algorithm" },
  ],
  create_default: () => ({ action: "hash", input: "", algorithm: "sha256", encoding: "hex", key: "", expected: "" }),
  EditPanel: HashEditPanel,
};
