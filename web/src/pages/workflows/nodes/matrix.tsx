import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["multiply", "transpose", "inverse", "determinant", "add", "subtract", "scalar", "solve", "identity", "trace"];

function MatrixEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "multiply");
  const needs_b = ["multiply", "add", "subtract", "solve"].includes(action);
  const needs_scalar = action === "scalar";
  const needs_size = action === "identity";
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      {!needs_size && (
        <JsonField label={t("workflows.matrix_a_json")} value={node.a} onUpdate={(v) => update({ a: v })} placeholder="[[1,2],[3,4]]" />
      )}
      {needs_b && (
        <JsonField label={t("workflows.matrix_b_json")} value={node.b} onUpdate={(v) => update({ b: v })} placeholder="[[5,6],[7,8]]" />
      )}
      {needs_scalar && (
        <BuilderField label={t("workflows.field_scalar")} required>
          <input className="input input--sm" type="number" required value={String(node.scalar ?? 1)} onChange={(e) => update({ scalar: Number(e.target.value) })} aria-required="true" />
        </BuilderField>
      )}
      {needs_size && (
        <BuilderField label={t("workflows.field_size")} required>
          <input className="input input--sm" type="number" min={1} required value={String(node.size ?? 3)} onChange={(e) => update({ size: Number(e.target.value) || 3 })} aria-required="true" />
        </BuilderField>
      )}
    </>
  );
}

export const matrix_descriptor: FrontendNodeDescriptor = {
  node_type: "matrix",
  icon: "🧮",
  color: "#4527a0",
  shape: "rect",
  toolbar_label: "node.matrix.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.matrix.output.result" },
    { name: "success", type: "boolean", description: "node.matrix.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.matrix.input.action" },
    { name: "a", type: "string", description: "node.matrix.input.a" },
  ],
  create_default: () => ({ action: "multiply", a: "", b: "", scalar: 1 }),
  EditPanel: MatrixEditPanel,
};
