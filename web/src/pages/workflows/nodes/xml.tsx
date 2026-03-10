import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "generate", "query", "validate", "pretty"];

function XmlEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_input")} required>
        <textarea className="input" required rows={4} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder="<root><item>value</item></root>" aria-required="true" />
      </BuilderField>
      {action === "query" && (
        <BuilderField label={t("workflows.field_xpath")} required>
          <input className="input input--sm" required value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="//item/text()" aria-required="true" />
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
    { name: "data", type: "string", description: "node.xml.input.data" },
  ],
  create_default: () => ({ action: "parse", data: "", path: "" }),
  EditPanel: XmlEditPanel,
};
