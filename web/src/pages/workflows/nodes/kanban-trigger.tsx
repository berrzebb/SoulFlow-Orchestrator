import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const KANBAN_ACTIONS = ["created", "moved", "updated", "archived", "commented", "assigned", "priority_changed", "labels_changed", "due_date_set"];

function KanbanTriggerEditPanel({ node, update, t }: EditPanelProps) {
  const actions = (node.kanban_actions as string[]) || ["created"];
  const toggle_action = (action: string) => {
    const next = actions.includes(action) ? actions.filter((a) => a !== action) : [...actions, action];
    update({ kanban_actions: next });
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.kanban_trigger_board_id")}</label>
        <input autoFocus className="input input--sm" value={String(node.kanban_board_id || "")} onChange={(e) => update({ kanban_board_id: e.target.value })} placeholder="board_id or scope:workflow:name" />
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.kanban_trigger_actions")}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {KANBAN_ACTIONS.map((action) => (
            <button key={action} type="button" className={`badge ${actions.includes(action) ? "badge--active" : ""}`} onClick={() => toggle_action(action)} style={{ cursor: "pointer", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)", background: actions.includes(action) ? "var(--accent)" : "transparent", color: actions.includes(action) ? "#fff" : "var(--text-secondary)", fontSize: "12px" }}>
              {action}
            </button>
          ))}
        </div>
      </div>
      <div className="builder-row">
        <label className="label">{t("workflows.kanban_trigger_column_id")}</label>
        <input className="input input--sm" value={String(node.kanban_column_id || "")} onChange={(e) => update({ kanban_column_id: e.target.value })} placeholder="todo, in_progress, done ..." />
        <small className="hint">{t("workflows.kanban_trigger_column_hint")}</small>
      </div>
    </>
  );
}

export const kanban_trigger_descriptor: FrontendNodeDescriptor = {
  node_type: "kanban_trigger",
  icon: "\u{1F4CB}",
  color: "#9b59b6",
  shape: "rect",
  toolbar_label: "node.kanban_trigger.label",
  category: "integration",
  output_schema: [
    { name: "card_id",    type: "string",  description: "node.kanban_trigger.output.card_id" },
    { name: "board_id",   type: "string",  description: "node.kanban_trigger.output.board_id" },
    { name: "action",     type: "string",  description: "node.kanban_trigger.output.action" },
    { name: "actor",      type: "string",  description: "node.kanban_trigger.output.actor" },
    { name: "detail",     type: "object",  description: "node.kanban_trigger.output.detail" },
    { name: "created_at", type: "string",  description: "node.kanban_trigger.output.created_at" },
  ],
  input_schema: [],
  create_default: () => ({
    trigger_type: "kanban_event",
    kanban_board_id: "",
    kanban_actions: ["created"],
    kanban_column_id: "",
  }),
  EditPanel: KanbanTriggerEditPanel,
};
