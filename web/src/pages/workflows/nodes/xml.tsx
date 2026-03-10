import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "query", "validate", "pretty"];

function XmlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input input--sm" required rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="<root><item>value</item></root>" aria-required="true" />
      </BuilderField>
      {action === "query" && (
        <BuilderField label={t("workflows.field_xpath")} required>
          <input className="input input--sm" required value={String(node.xpath || "")} onChange={(e) => update({ xpath: e.target.value })} placeholder="//item/text()" aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const xml_descriptor: FrontendNodeDescriptor = {
  node_type: "xml",
  icon: "📝",
  color: "#607d8b",
  shape: "rect",
  toolbar_label: "node.xml.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.xml.output.result" },
    { name: "success", type: "boolean", description: "node.xml.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.xml.input.action" },
    { name: "input", type: "string", description: "node.xml.input.input" },
  ],
  create_default: () => ({ action: "parse", input: "", xpath: "" }),
  EditPanel: XmlEditPanel,
};
