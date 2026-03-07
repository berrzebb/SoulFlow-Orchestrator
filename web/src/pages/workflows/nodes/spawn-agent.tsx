import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function SpawnAgentEditPanel({ node, update, t, options }: EditPanelProps) {
  const models = options?.models || [];
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.spawn_task")}</label>
        <textarea className="input code-textarea" rows={3} value={String(node.task || "")} onChange={(e) => update({ task: e.target.value })} spellCheck={false} placeholder="Analyze the data and generate a report..." />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.spawn_role")}</label>
          <input className="input input--sm" value={String(node.role || "")} onChange={(e) => update({ role: e.target.value })} placeholder="assistant" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.llm_model")}</label>
          {models.length > 0 ? (
            <select className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })}>
              <option value="">auto</option>
              {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.model || "")} onChange={(e) => update({ model: e.target.value })} placeholder="auto" />
          )}
        </div>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.spawn_await")}</label>
          <select className="input input--sm" value={String(node.await_completion ?? true)} onChange={(e) => update({ await_completion: e.target.value === "true" })}>
            <option value="true">{t("workflows.opt_yes")}</option>
            <option value="false">{t("workflows.opt_no_fire_forget")}</option>
          </select>
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.spawn_max_iter")}</label>
          <input className="input input--sm" type="number" min={1} max={100} value={String(node.max_iterations ?? 10)} onChange={(e) => update({ max_iterations: Number(e.target.value) || 10 })} />
        </div>
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.spawn_origin_channel")}</label>
          <input className="input input--sm" value={String(node.origin_channel || "")} onChange={(e) => update({ origin_channel: e.target.value || undefined })} placeholder="{{memory.origin.channel}}" />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.spawn_origin_chat")}</label>
          <input className="input input--sm" value={String(node.origin_chat_id || "")} onChange={(e) => update({ origin_chat_id: e.target.value || undefined })} placeholder="{{memory.origin.chat_id}}" />
        </div>
      </div>
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
