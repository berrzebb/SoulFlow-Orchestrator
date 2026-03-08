import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TokenizerEditPanel({ t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.tokenizer.description")} hint={t("node.tokenizer.hint")}>
      {null}
    </BuilderField>
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
    { name: "data", type: "string", description: "node.tokenizer.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: TokenizerEditPanel,
};
