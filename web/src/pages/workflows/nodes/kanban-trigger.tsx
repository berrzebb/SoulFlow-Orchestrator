import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const KANBAN_ACTIONS: { value: string; i18n: string }[] = [
  { value: "created",          i18n: "workflows.kanban_action_created" },
  { value: "moved",            i18n: "workflows.kanban_action_moved" },
  { value: "updated",          i18n: "workflows.kanban_action_updated" },
  { value: "archived",         i18n: "workflows.kanban_action_archived" },
  { value: "commented",        i18n: "workflows.kanban_action_commented" },
  { value: "assigned",         i18n: "workflows.kanban_action_assigned" },
  { value: "priority_changed", i18n: "workflows.kanban_action_priority_changed" },
  { value: "labels_changed",   i18n: "workflows.kanban_action_labels_changed" },
  { value: "due_date_set",     i18n: "workflows.kanban_action_due_date_set" },
];

function KanbanTriggerEditPanel({ node, update, t, options }: EditPanelProps) {
  const mode = (node.kanban_mode as string) || "event";
  const actions = (node.kanban_actions as string[]) || ["created"];
  const boards = options?.kanban_boards || [];
  const toggle_action = (value: string) => {
    const next = actions.includes(value) ? actions.filter((a) => a !== value) : [...actions, value];
    update({ kanban_actions: next });
  };
  const list_id = "kanban-board-list";

  return (
    <>
      {/* 동작 방식 선택 */}
      <BuilderField label={t("workflows.kanban_trigger_mode")} hint={t("workflows.kanban_trigger_mode_hint")}>
        <div style={{ display: "flex", gap: "6px" }}>
          {(["event", "poll"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => update({ kanban_mode: m })}
              style={{
                cursor: "pointer",
                padding: "4px 14px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: mode === m ? "var(--accent)" : "transparent",
                color: mode === m ? "#fff" : "var(--text-secondary)",
                fontSize: "12px",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {t(`workflows.kanban_trigger_mode_${m}`)}
            </button>
          ))}
        </div>
      </BuilderField>

      {/* 공통: 보드 ID */}
      <BuilderField label={t("workflows.kanban_trigger_board_id")} hint={t("workflows.kanban_trigger_board_id_hint")}>
        {boards.length > 0 && <datalist id={list_id}>{boards.map((b) => <option key={b.board_id} value={b.board_id}>{b.name}</option>)}</datalist>}
        <input autoFocus className="input input--sm" list={boards.length > 0 ? list_id : undefined} value={String(node.kanban_board_id || "")} onChange={(e) => update({ kanban_board_id: e.target.value })} placeholder="board_id or scope:workflow:name" />
      </BuilderField>

      {/* 이벤트 방식 전용: 액션 필터 */}
      {mode === "event" && (
        <BuilderField label={t("workflows.kanban_trigger_actions")}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {KANBAN_ACTIONS.map(({ value, i18n }) => (
              <button key={value} type="button" onClick={() => toggle_action(value)} style={{ cursor: "pointer", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)", background: actions.includes(value) ? "var(--accent)" : "transparent", color: actions.includes(value) ? "#fff" : "var(--text-secondary)", fontSize: "12px" }}>
                {t(i18n)}
              </button>
            ))}
          </div>
        </BuilderField>
      )}

      {/* 컬럼 필터: 이벤트 방식은 선택적, 폴링 방식은 필수 */}
      <BuilderField
        label={t("workflows.kanban_trigger_column_id")}
        hint={mode === "poll" ? t("workflows.kanban_trigger_column_hint_poll") : t("workflows.kanban_trigger_column_hint")}
      >
        <input
          className="input input--sm"
          value={String(node.kanban_column_id || "")}
          onChange={(e) => update({ kanban_column_id: e.target.value })}
          placeholder={mode === "poll" ? t("workflows.kanban_trigger_column_placeholder_poll") : "todo, in_progress, done ..."}
          required={mode === "poll"}
        />
      </BuilderField>

      {/* 폴링 방식 전용: 스캔 간격 */}
      {mode === "poll" && (
        <BuilderField label={t("workflows.kanban_trigger_poll_interval")} hint={t("workflows.kanban_trigger_poll_interval_hint")}>
          <input
            type="number"
            className="input input--sm"
            min={10}
            step={10}
            value={String(node.kanban_poll_interval_s ?? 60)}
            onChange={(e) => update({ kanban_poll_interval_s: Math.max(10, parseInt(e.target.value) || 60) })}
          />
        </BuilderField>
      )}
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
    { name: "cards",      type: "array",   description: "node.kanban_trigger.output.cards" },
  ],
  input_schema: [],
  create_default: () => ({
    trigger_type: "kanban_event",
    kanban_board_id: "",
    kanban_actions: ["created"],
    kanban_column_id: "",
    kanban_mode: "event",
    kanban_poll_interval_s: 60,
  }),
  EditPanel: KanbanTriggerEditPanel,
};
