import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["word_tokenize", "sentence_split", "ngrams", "tf_idf", "keyword_extract", "stopword_filter", "token_estimate"];

function TokenizerEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "word_tokenize");
  return (
    <>
      {(action === "ngrams" || action === "keyword_extract" || action === "tf_idf") ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          {action === "ngrams" ? (
            <BuilderField label={t("workflows.tokenizer_n")}>
              <input className="input input--sm" type="number" min={1} max={10} value={String(node.n ?? 2)} onChange={(e) => update({ n: Number(e.target.value) || 2 })} />
            </BuilderField>
          ) : (
            <BuilderField label={t("workflows.tokenizer_top_k")}>
              <input className="input input--sm" type="number" min={1} value={String(node.top_k ?? 10)} onChange={(e) => update({ top_k: Number(e.target.value) || 10 })} />
            </BuilderField>
          )}
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      )}
      <BuilderField label={t("workflows.field_text")} required>
        <textarea className="input" required rows={4} value={String(node.text || "")} onChange={(e) => update({ text: e.target.value })} placeholder="Enter text to tokenize..." aria-required="true" />
      </BuilderField>
    </>
  );
}

export const tokenizer_descriptor: FrontendNodeDescriptor = {
  node_type: "tokenizer",
  icon: "💬",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.tokenizer.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.tokenizer.output.result" },
    { name: "success", type: "boolean", description: "node.tokenizer.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.tokenizer.input.action" },
    { name: "text", type: "string", description: "node.tokenizer.input.text" },
  ],
  create_default: () => ({ action: "word_tokenize", text: "", n: 2, top_k: 10 }),
  EditPanel: TokenizerEditPanel,
};
