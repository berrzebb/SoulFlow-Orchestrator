import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["extract_text", "extract_links", "extract_tables", "sanitize", "to_markdown"];
const SELECTOR_ACTIONS = ["extract_text", "extract_links"];

function HtmlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "extract_text");
  return (
    <>
      {SELECTOR_ACTIONS.includes(action) ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.html_selector")}>
            <input className="input input--sm" value={String(node.selector || "")} onChange={(e) => update({ selector: e.target.value })} placeholder="div.content" />
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      )}
      <BuilderField label={t("workflows.html_input")} required>
        <textarea className="input" required rows={5} value={String(node.html || "")} onChange={(e) => update({ html: e.target.value })} placeholder="<html>...</html>" aria-required="true" />
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
    { name: "html", type: "string", description: "node.html.input.html" },
  ],
  create_default: () => ({ action: "extract_text", html: "", selector: "" }),
  EditPanel: HtmlEditPanel,
};
