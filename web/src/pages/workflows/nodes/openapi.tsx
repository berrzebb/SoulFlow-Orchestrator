import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["parse", "list_endpoints", "get_operation", "validate", "generate_client", "to_markdown"];
const LANGS = ["typescript", "python", "java", "go", "csharp"];

function OpenapiEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "parse");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
          {ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.openapi_spec")} required>
        <textarea className="input" required rows={5} value={String(node.spec || "")} onChange={(e) => update({ spec: e.target.value })} placeholder='{"openapi": "3.0.0", ...}' aria-required="true" />
      </BuilderField>
      {action === "get_operation" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_method")}>
            <input className="input input--sm" value={String(node.method || "")} onChange={(e) => update({ method: e.target.value })} placeholder="GET" />
          </BuilderField>
          <BuilderField label={t("workflows.field_path")}>
            <input className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="/users/{id}" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {action === "generate_client" && (
        <BuilderField label={t("workflows.field_language")}>
          <select className="input input--sm" value={String(node.language || "typescript")} onChange={(e) => update({ language: e.target.value })}>
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </BuilderField>
      )}
    </>
  );
}

export const openapi_descriptor: FrontendNodeDescriptor = {
  node_type: "openapi",
  icon: "📖",
  color: "#43a047",
  shape: "rect",
  toolbar_label: "node.openapi.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "object", description: "node.openapi.output.result" },
    { name: "success", type: "boolean", description: "node.openapi.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.openapi.input.action" },
    { name: "spec", type: "string", description: "node.openapi.input.spec" },
  ],
  create_default: () => ({ action: "parse", spec: "", method: "", path: "", language: "typescript" }),
  EditPanel: OpenapiEditPanel,
};
