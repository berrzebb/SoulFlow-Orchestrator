import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function QueueEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "enqueue");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            {["enqueue", "dequeue", "peek", "size", "drain", "list", "clear", "delete"].map((o) => <option key={o} value={o}>{t(`node.action.${o}`)}</option>)}
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.field_queue")}>
          <input className="input input--sm" value={String(node.queue || "default")} onChange={(e) => update({ queue: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>
      {op === "enqueue" && (
        <>
          <BuilderField label={t("workflows.field_value")}>
            <textarea className="input code-textarea" rows={2} value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} />
          </BuilderField>
          {String(node.mode) === "priority" ? (
            <BuilderRowPair>
              <BuilderField label={t("workflows.field_mode")}>
                <select className="input input--sm" value={String(node.mode || "fifo")} onChange={(e) => update({ mode: e.target.value })}>
                  {["fifo", "lifo", "priority"].map((m) => <option key={m} value={m}>{t(`node.action.${m}`)}</option>)}
                </select>
              </BuilderField>
              <BuilderField label={t("workflows.field_priority")}>
                <input className="input input--sm" type="number" min={0} max={100} value={String(node.priority ?? 50)} onChange={(e) => update({ priority: Number(e.target.value) })} />
              </BuilderField>
            </BuilderRowPair>
          ) : (
            <BuilderField label={t("workflows.field_mode")}>
              <select className="input input--sm" value={String(node.mode || "fifo")} onChange={(e) => update({ mode: e.target.value })}>
                {["fifo", "lifo", "priority"].map((m) => <option key={m} value={m}>{t(`node.action.${m}`)}</option>)}
              </select>
            </BuilderField>
          )}
        </>
      )}
      {op === "drain" && (
        <BuilderField label={t("workflows.field_count")}>
          <input className="input input--sm" type="number" min={1} max={1000} value={String(node.count ?? 10)} onChange={(e) => update({ count: Number(e.target.value) })} />
        </BuilderField>
      )}
    </>
  );
}

export const queue_descriptor: FrontendNodeDescriptor = {
  node_type: "queue",
  icon: "\u{1F4E5}",
  color: "#e65100",
  shape: "rect",
  toolbar_label: "node.queue.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.queue.output.result" },
    { name: "success", type: "boolean", description: "node.queue.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.queue.input.operation" },
    { name: "queue",     type: "string", description: "node.queue.input.queue" },
  ],
  create_default: () => ({ operation: "enqueue", queue: "default", value: "", mode: "fifo", priority: 50, count: 10 }),
  EditPanel: QueueEditPanel,
};
