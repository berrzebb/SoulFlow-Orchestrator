import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["cosine", "jaccard", "levenshtein", "hamming", "dice", "jaro_winkler", "euclidean"];
const MODES = ["char", "word", "token"];

function SimilarityEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "cosine");
  const has_mode = ["cosine", "jaccard"].includes(action);
  return (
    <>
      {has_mode ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.similarity_mode")}>
            <select className="input input--sm" value={String(node.mode || "word")} onChange={(e) => update({ mode: e.target.value })}>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      )}
      <BuilderField label={t("workflows.similarity_text_a")} required>
        <input className="input input--sm" required value={String(node.a || "")} onChange={(e) => update({ a: e.target.value })} placeholder="hello world" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.similarity_text_b")} required>
        <input className="input input--sm" required value={String(node.b || "")} onChange={(e) => update({ b: e.target.value })} placeholder="hello there" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const similarity_descriptor: FrontendNodeDescriptor = {
  node_type: "similarity",
  icon: "🔍",
  color: "#4a148c",
  shape: "rect",
  toolbar_label: "node.similarity.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "object", description: "node.similarity.output.result" },
    { name: "success", type: "boolean", description: "node.similarity.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.similarity.input.action" },
    { name: "a", type: "string", description: "node.similarity.input.a" },
    { name: "b", type: "string", description: "node.similarity.input.b" },
  ],
  create_default: () => ({ action: "cosine", a: "", b: "", mode: "word" }),
  EditPanel: SimilarityEditPanel,
};
