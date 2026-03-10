import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function BatchEditPanel({ node, update, t, options }: EditPanelProps) {
  const wf_nodes = options?.workflow_nodes;
  const list_id = "batch-body-node-list";
  return (
    <>
      <BuilderField label={t("workflows.batch_array_field")} hint={t("workflows.batch_array_field_hint")}>
        <input autoFocus className="input input--sm" value={String(node.array_field || "")} onChange={(e) => update({ array_field: e.target.value })} placeholder="memory.items" aria-label={t("workflows.batch_array_field")} />
      </BuilderField>
      <BuilderField label={t("workflows.batch_body_node")} hint={t("workflows.batch_body_node_hint")}>
        {wf_nodes && <datalist id={list_id}>{wf_nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</datalist>}
        <input className="input input--sm" list={wf_nodes ? list_id : undefined} value={String(node.body_node || "")} onChange={(e) => update({ body_node: e.target.value })} placeholder="process_item" aria-label={t("workflows.batch_body_node")} />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.batch_concurrency")} hint={t("workflows.batch_concurrency_hint")}>
          <input className="input input--sm" type="number" min={1} max={50} value={String(node.concurrency ?? 5)} onChange={(e) => update({ concurrency: Number(e.target.value) })} aria-label={t("workflows.batch_concurrency")} />
        </BuilderField>
        <BuilderField label={t("workflows.batch_on_error")}>
          <select className="input input--sm" value={String(node.on_item_error || "continue")} onChange={(e) => update({ on_item_error: e.target.value })} aria-label={t("workflows.batch_on_error")}>
            <option value="continue">{t("workflows.batch_on_error_continue")}</option>
            <option value="halt">{t("workflows.batch_on_error_halt")}</option>
          </select>
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const batch_descriptor: FrontendNodeDescriptor = {
  node_type: "batch",
  icon: "⚡",
  color: "#673ab7",
  shape: "rect",
  toolbar_label: "node.batch.label",
  category: "flow",
  output_schema: [
    { name: "results",   type: "array",  description: "node.batch.output.results" },
    { name: "total",     type: "number", description: "node.batch.output.total" },
    { name: "succeeded", type: "number", description: "node.batch.output.succeeded" },
    { name: "failed",    type: "number", description: "node.batch.output.failed" },
    { name: "errors",    type: "array",  description: "node.batch.output.errors" },
  ],
  input_schema: [
    { name: "array_field", type: "string", description: "node.batch.input.array_field" },
    { name: "concurrency", type: "number", description: "node.batch.input.concurrency" },
  ],
  create_default: () => ({ array_field: "", concurrency: 5, body_node: "", on_item_error: "continue" }),
  EditPanel: BatchEditPanel,
};
