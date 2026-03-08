import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair, JsonField } from "../builder-field";

function TaskEditPanel({ node, update, t, options }: EditPanelProps) {
  const channels = options?.channels || [];
  return (
    <>
      <BuilderField label={t("workflows.task_title")} required>
        <input autoFocus required className="input input--sm" value={String(node.task_title || "")} onChange={(e) => update({ task_title: e.target.value })} placeholder="Process user request" aria-required="true" />
      </BuilderField>
      <BuilderField label={t("workflows.task_objective")} required>
        <textarea required className="input code-textarea" rows={3} value={String(node.objective || "")} onChange={(e) => update({ objective: e.target.value })} spellCheck={false} placeholder="{{memory.user_request}}" aria-required="true" />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.task_channel")}>
          {channels.length > 0 ? (
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label || c.provider}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })} placeholder="slack" />
          )}
        </BuilderField>
        <BuilderField label={t("workflows.max_turns")} required hint={t("workflows.task_max_turns_hint")}>
          <input required className="input input--sm" type="number" min={1} max={200} value={String(node.max_turns ?? 20)} onChange={(e) => update({ max_turns: Number(e.target.value) || 20 })} aria-required="true" />
        </BuilderField>
      </BuilderRowPair>
      <JsonField label={t("workflows.task_memory")} value={node.initial_memory} onUpdate={(v) => update({ initial_memory: v })} rows={2} placeholder='{"context": "{{memory.prev.result}}"}' />
    </>
  );
}

export const task_descriptor: FrontendNodeDescriptor = {
  node_type: "task",
  icon: "☑",
  color: "#4caf50",
  shape: "rect",
  toolbar_label: "node.task.label",
  category: "advanced",
  output_schema: [
    { name: "task_id",     type: "string", description: "node.task.output.task_id" },
    { name: "status",      type: "string", description: "node.task.output.status" },
    { name: "result",      type: "object", description: "node.task.output.result" },
    { name: "exit_reason", type: "string", description: "node.task.output.exit_reason" },
  ],
  input_schema: [
    { name: "task_title", type: "string", description: "node.task.input.task_title" },
    { name: "objective",  type: "string", description: "node.task.input.objective" },
    { name: "channel",    type: "string", description: "node.task.input.channel" },
  ],
  create_default: () => ({ task_title: "", objective: "", max_turns: 20 }),
  EditPanel: TaskEditPanel,
};
