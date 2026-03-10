import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function SpawnAgentEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  return (
    <>
      <BuilderField label={t("workflows.spawn_task")}>
        <textarea autoFocus className="input code-textarea" rows={3} value={String(node.task || "")} onChange={(e) => update({ task: e.target.value })} spellCheck={false} placeholder={t("node.spawn_agent.task_placeholder")} />
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.spawn_role")}>
          <input className="input input--sm" value={String(node.role || "")} onChange={(e) => update({ role: e.target.value })} placeholder="assistant" />
        </BuilderField>
        <BuilderField label={t("workflows.llm_model")}>
          {models.length > 0 ? (
            <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
              <option value="">auto</option>
              {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="auto" />
          )}
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.spawn_await")}>
          <select className="input input--sm" value={String(node.await_completion ?? true)} onChange={(e) => update({ await_completion: e.target.value === "true" })}>
            <option value="true">{t("workflows.opt_yes")}</option>
            <option value="false">{t("workflows.opt_no_fire_forget")}</option>
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.spawn_max_iter")} hint={t("workflows.spawn_max_iter_hint")}>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.max_iterations ?? 10)} onChange={(e) => update({ max_iterations: Number(e.target.value) || 10 })} />
        </BuilderField>
      </BuilderRowPair>
      <BuilderRowPair>
        <BuilderField label={t("workflows.spawn_origin_channel")}>
          <input className="input input--sm" value={String(node.origin_channel || "")} onChange={(e) => update({ origin_channel: e.target.value || undefined })} placeholder="{{memory.origin.channel}}" />
        </BuilderField>
        <BuilderField label={t("workflows.spawn_origin_chat")}>
          <input className="input input--sm" value={String(node.origin_chat_id || "")} onChange={(e) => update({ origin_chat_id: e.target.value || undefined })} placeholder="{{memory.origin.chat_id}}" />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const spawn_agent_descriptor: FrontendNodeDescriptor = {
  node_type: "spawn_agent",
  icon: "⚡",
  color: "#ff9800",
  shape: "rect",
  toolbar_label: "node.spawn_agent.label",
  category: "ai",
  output_schema: [
    { name: "agent_id", type: "string", description: "node.spawn_agent.output.agent_id" },
    { name: "status",   type: "string", description: "node.spawn_agent.output.status" },
    { name: "result",   type: "string", description: "node.spawn_agent.output.result" },
  ],
  input_schema: [
    { name: "task",  type: "string", description: "node.spawn_agent.input.task" },
    { name: "role",  type: "string", description: "node.spawn_agent.input.role" },
    { name: "model", type: "string", description: "node.spawn_agent.input.model" },
  ],
  create_default: () => ({ task: "", role: "assistant", await_completion: true, max_iterations: 10 }),
  EditPanel: SpawnAgentEditPanel,
};
