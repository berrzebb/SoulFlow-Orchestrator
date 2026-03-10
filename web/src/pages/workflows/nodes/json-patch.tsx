import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const JSON_PATCH_ACTIONS = ["apply", "diff", "validate", "test"] as const;

function JsonPatchEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "apply");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {JSON_PATCH_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.json_patch_document")} required hint={t("workflows.json_patch_document_hint")}>
        <textarea className="input" rows={4} value={String(node.document || "{}")} onChange={(e) => update({ document: e.target.value })} placeholder='{"name":"Alice","age":30}' />
      </BuilderField>
      {action === "diff" ? (
        <BuilderField label={t("workflows.json_patch_target")} required hint={t("workflows.json_patch_target_hint")}>
          <textarea className="input" rows={4} value={String(node.target || "{}")} onChange={(e) => update({ target: e.target.value })} placeholder='{"name":"Bob","age":25}' />
        </BuilderField>
      ) : (
        <BuilderField label={t("workflows.json_patch_patch")} required hint={t("workflows.json_patch_patch_hint")}>
          <textarea className="input" rows={4} value={String(node.patch || "[]")} onChange={(e) => update({ patch: e.target.value })} placeholder='[{"op":"replace","path":"/name","value":"Bob"}]' />
        </BuilderField>
      )}
    </>
  );
}

export const json_patch_descriptor: FrontendNodeDescriptor = {
  node_type: "json_patch",
  icon: "\u{1F527}",
  color: "#546e7a",
  shape: "rect",
  toolbar_label: "node.json_patch.label",
  category: "data",
  output_schema: [
    { name: "result", type: "object",  description: "node.json_patch.output.result" },
    { name: "patch",  type: "array",   description: "node.json_patch.output.patch" },
    { name: "valid",  type: "boolean", description: "node.json_patch.output.valid" },
  ],
  input_schema: [
    { name: "action",   type: "string", description: "node.json_patch.input.action" },
    { name: "document", type: "string", description: "node.json_patch.input.document" },
    { name: "patch",    type: "string", description: "node.json_patch.input.patch" },
  ],
  create_default: () => ({ action: "apply", document: "{}", patch: "[]", target: "{}" }),
  EditPanel: JsonPatchEditPanel,
};
