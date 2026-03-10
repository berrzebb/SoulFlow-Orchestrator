import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["extract_text", "extract_links", "extract_tables", "sanitize", "to_markdown"];

function HtmlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "extract_text");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.html_input")} required>
        <textarea className="input input--sm" required rows={5} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="<html>...</html>" aria-required="true" />
      </BuilderField>
    </>
  );
}

export const html_descriptor: FrontendNodeDescriptor = {
  node_type: "html",
  icon: "🌐",
  color: "#e44d26",
  shape: "rect",
  toolbar_label: "node.html.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.html.output.result" },
    { name: "success", type: "boolean", description: "node.html.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.html.input.action" },
    { name: "input", type: "string", description: "node.html.input.input" },
  ],
  create_default: () => ({ action: "extract_text", input: "" }),
  EditPanel: HtmlEditPanel,
};
