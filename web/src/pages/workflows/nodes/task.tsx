import { useState } from "react";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function TaskEditPanel({ node, update, t, options }: EditPanelProps) {
  const channels = options?.channels || [];
  const [memoryRaw, setMemoryRaw] = useState(node.initial_memory ? JSON.stringify(node.initial_memory, null, 2) : "");
  const [memoryErr, setMemoryErr] = useState("");

  const handleMemory = (val: string) => {
    setMemoryRaw(val);
    if (!val.trim()) { setMemoryErr(""); update({ initial_memory: undefined }); return; }
    try { update({ initial_memory: JSON.parse(val) }); setMemoryErr(""); }
    catch { setMemoryErr(t("workflows.invalid_json")); }
  };
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.task_title")}<span className="label__required">*</span></label>
        <input autoFocus required className="input input--sm" value={String(node.task_title || "")} onChange={(e) => update({ task_title: e.target.value })} placeholder="Process user request" aria-required="true" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.task_objective")}<span className="label__required">*</span></label>
        <textarea required className="input code-textarea" rows={3} value={String(node.objective || "")} onChange={(e) => update({ objective: e.target.value })} spellCheck={false} placeholder="{{memory.user_request}}" aria-required="true" />
      </div>
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">{t("workflows.task_channel")}</label>
          {channels.length > 0 ? (
            <select className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {channels.map((c) => <option key={c.channel_id} value={c.provider}>{c.label || c.provider}</option>)}
            </select>
          ) : (
            <input className="input input--sm" value={String(node.channel || "")} onChange={(e) => update({ channel: e.target.value })} placeholder="slack" />
          )}
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.max_turns")}<span className="label__required">*</span></label>
          <input required className="input input--sm" type="number" min={1} max={200} value={String(node.max_turns ?? 20)} onChange={(e) => update({ max_turns: Number(e.target.value) || 20 })} aria-required="true" />
          <span className="builder-hint">{t("workflows.task_max_turns_hint")}</span>
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.task_memory")}</label>
        <textarea
          className={`input code-textarea${memoryErr ? " input--err" : ""}`}
          rows={2}
          value={memoryRaw}
          onChange={(e) => handleMemory(e.target.value)}
          spellCheck={false}
          placeholder='{"context": "{{memory.prev.result}}"}'
        />
        {memoryErr && <span className="field-error">{memoryErr}</span>}
      </div>
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
