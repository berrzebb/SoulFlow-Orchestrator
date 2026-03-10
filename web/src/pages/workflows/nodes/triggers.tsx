/** 트리거 노드 FrontendNodeDescriptor 등록 — node_type: "trigger_{trigger_type}". */

import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

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

// ── Cron ──────────────────────────────────────────────────────────────────────

function CronTriggerEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <BuilderField label={t("workflows.cron_schedule")} hint={t("workflows.cron_hint")}>
        <input autoFocus className="input input--sm" value={String(node.schedule || "")} onChange={(e) => update({ schedule: e.target.value })} placeholder="0 9 * * *" />
      </BuilderField>
      <BuilderField label={t("workflows.timezone")}>
        <input className="input input--sm" value={String(node.timezone || "")} onChange={(e) => update({ timezone: e.target.value || undefined })} placeholder="Asia/Seoul" />
      </BuilderField>
    </>
  );
}

export const trigger_cron_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_cron",
  icon: "⏰",
  color: "#e67e22",
  shape: "rect",
  toolbar_label: "node.trigger_cron.label",
  category: "integration",
  output_schema: [
    { name: "fired_at", type: "string", description: "node.trigger_cron.output.fired_at" },
    { name: "schedule", type: "string", description: "node.trigger_cron.output.schedule" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "cron", schedule: "0 9 * * *" }),
  EditPanel: CronTriggerEditPanel,
};

// ── Webhook ───────────────────────────────────────────────────────────────────

function WebhookTriggerEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("workflows.webhook_path")} hint={t("workflows.webhook_path_hint")}>
      <input autoFocus className="input input--sm" value={String(node.webhook_path || "")} onChange={(e) => update({ webhook_path: e.target.value })} placeholder="/hooks/my-workflow" />
    </BuilderField>
  );
}

export const trigger_webhook_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_webhook",
  icon: "↗",
  color: "#3498db",
  shape: "rect",
  toolbar_label: "node.trigger_webhook.label",
  category: "integration",
  output_schema: [
    { name: "payload", type: "object", description: "node.trigger_webhook.output.payload" },
    { name: "headers", type: "object", description: "node.trigger_webhook.output.headers" },
    { name: "method",  type: "string", description: "node.trigger_webhook.output.method" },
    { name: "path",    type: "string", description: "node.trigger_webhook.output.path" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "webhook", webhook_path: "" }),
  EditPanel: WebhookTriggerEditPanel,
};

// ── Manual ────────────────────────────────────────────────────────────────────

function ManualTriggerEditPanel({ t }: EditPanelProps) {
  return (
    <div className="builder-row">
      <span className="builder-hint">{t("workflows.trigger_manual_hint")}</span>
    </div>
  );
}

export const trigger_manual_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_manual",
  icon: "▶",
  color: "#2ecc71",
  shape: "rect",
  toolbar_label: "node.trigger_manual.label",
  category: "integration",
  output_schema: [
    { name: "objective", type: "string", description: "node.trigger_manual.output.objective" },
    { name: "chat_id",   type: "string", description: "node.trigger_manual.output.chat_id" },
    { name: "channel",   type: "string", description: "node.trigger_manual.output.channel" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "manual" }),
  EditPanel: ManualTriggerEditPanel,
};

// ── Channel Message ───────────────────────────────────────────────────────────

function ChannelTriggerEditPanel({ node, update, t, options }: EditPanelProps) {
  const channels = options?.channels || [];
  const channel_type = String(node.channel_type || "");
  return (
    <>
      <BuilderField label={t("workflows.channel_type")} required hint={t("workflows.channel_type_hint")}>
        {channels.length > 0 ? (
          <select autoFocus className="input input--sm" required value={channel_type} onChange={(e) => update({ channel_type: e.target.value })} aria-required="true">
            <option value="">{t("workflows.channel_any")}</option>
            {channels.map((c) => (
              <option key={c.channel_id} value={c.provider}>{c.label || c.provider}</option>
            ))}
          </select>
        ) : (
          <input autoFocus className="input input--sm" value={channel_type} onChange={(e) => update({ channel_type: e.target.value })} placeholder="slack" />
        )}
      </BuilderField>
      <BuilderField label={t("workflows.channel_chat_id")} hint={t("workflows.channel_chat_id_hint")}>
        <input className="input input--sm" value={String(node.chat_id || "")} onChange={(e) => update({ chat_id: e.target.value || undefined })} placeholder="C01234567" />
      </BuilderField>
    </>
  );
}

export const trigger_channel_message_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_channel_message",
  icon: "💬",
  color: "#f1c40f",
  shape: "rect",
  toolbar_label: "node.trigger_channel_message.label",
  category: "integration",
  output_schema: [
    { name: "message",   type: "string", description: "node.trigger_channel_message.output.message" },
    { name: "chat_id",   type: "string", description: "node.trigger_channel_message.output.chat_id" },
    { name: "channel",   type: "string", description: "node.trigger_channel_message.output.channel" },
    { name: "sender_id", type: "string", description: "node.trigger_channel_message.output.sender_id" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "channel_message", channel_type: "slack" }),
  EditPanel: ChannelTriggerEditPanel,
};

// ── Kanban Event ──────────────────────────────────────────────────────────────

function KanbanEventTriggerEditPanel({ node, update, t, options }: EditPanelProps) {
  const actions = (node.kanban_actions as string[]) || [];
  const boards = options?.kanban_boards || [];
  const toggle_action = (value: string) => {
    const next = actions.includes(value) ? actions.filter((a) => a !== value) : [...actions, value];
    update({ kanban_actions: next });
  };
  const list_id = "kanban-board-list";

  return (
    <>
      <BuilderField label={t("workflows.kanban_trigger_board_id")} required hint={t("workflows.kanban_trigger_board_id_hint")}>
        {boards.length > 0 && <datalist id={list_id}>{boards.map((b) => <option key={b.board_id} value={b.board_id}>{b.name}</option>)}</datalist>}
        <input autoFocus required className="input input--sm" list={boards.length > 0 ? list_id : undefined} value={String(node.kanban_board_id || "")} onChange={(e) => update({ kanban_board_id: e.target.value })} placeholder="board_id or scope:workflow:name" />
      </BuilderField>
      <BuilderField label={t("workflows.kanban_trigger_actions")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {KANBAN_ACTIONS.map(({ value, i18n }) => (
            <button key={value} type="button"
              onClick={() => toggle_action(value)}
              style={{
                cursor: "pointer", padding: "2px 8px", borderRadius: "4px",
                border: "1px solid var(--border)",
                background: actions.includes(value) ? "var(--accent)" : "transparent",
                color: actions.includes(value) ? "#fff" : "var(--text-secondary)",
                fontSize: "12px",
              }}
            >
              {t(i18n)}
            </button>
          ))}
        </div>
      </BuilderField>
      <BuilderField label={t("workflows.kanban_trigger_column_id")} hint={t("workflows.kanban_trigger_column_hint")}>
        <input className="input input--sm" value={String(node.kanban_column_id || "")} onChange={(e) => update({ kanban_column_id: e.target.value })} placeholder="todo, in_progress, done ..." />
      </BuilderField>
    </>
  );
}

export const trigger_kanban_event_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_kanban_event",
  icon: "📋",
  color: "#9b59b6",
  shape: "rect",
  toolbar_label: "node.trigger_kanban_event.label",
  category: "integration",
  output_schema: [
    { name: "card_id",    type: "string", description: "node.kanban_trigger.output.card_id" },
    { name: "board_id",   type: "string", description: "node.kanban_trigger.output.board_id" },
    { name: "action",     type: "string", description: "node.kanban_trigger.output.action" },
    { name: "actor",      type: "string", description: "node.kanban_trigger.output.actor" },
    { name: "detail",     type: "object", description: "node.kanban_trigger.output.detail" },
    { name: "created_at", type: "string", description: "node.kanban_trigger.output.created_at" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "kanban_event", kanban_board_id: "", kanban_actions: ["created"] }),
  EditPanel: KanbanEventTriggerEditPanel,
};

// ── Filesystem Watch ──────────────────────────────────────────────────────────

const FS_WATCH_EVENTS: Array<{ value: "add" | "change" | "unlink"; i18n: string }> = [
  { value: "add",    i18n: "workflows.fs_watch_event_add" },
  { value: "change", i18n: "workflows.fs_watch_event_change" },
  { value: "unlink", i18n: "workflows.fs_watch_event_delete" },
];

function FilesystemWatchTriggerEditPanel({ node, update, t }: EditPanelProps) {
  const events = (node.watch_events as string[]) || ["add"];
  const toggle_event = (value: string) => {
    const next = events.includes(value) ? events.filter((e) => e !== value) : [...events, value];
    update({ watch_events: next });
  };

  return (
    <>
      <BuilderField label={t("workflows.fs_watch_path")} required hint={t("workflows.fs_watch_path_hint")}>
        <input autoFocus required className="input input--sm" value={String(node.watch_path || "")} onChange={(e) => update({ watch_path: e.target.value })} placeholder="inbox/" />
      </BuilderField>
      <BuilderField label={t("workflows.fs_watch_events")}>
        <div style={{ display: "flex", gap: "4px" }}>
          {FS_WATCH_EVENTS.map(({ value, i18n }) => (
            <button key={value} type="button" onClick={() => toggle_event(value)}
              style={{
                cursor: "pointer", padding: "2px 10px", borderRadius: "4px",
                border: "1px solid var(--border)",
                background: events.includes(value) ? "var(--accent)" : "transparent",
                color: events.includes(value) ? "#fff" : "var(--text-secondary)",
                fontSize: "12px",
              }}
            >
              {t(i18n)}
            </button>
          ))}
        </div>
      </BuilderField>
      <BuilderRowPair>
        <BuilderField label={t("workflows.fs_watch_pattern")} hint={t("workflows.fs_watch_pattern_hint")}>
          <input className="input input--sm" value={String(node.watch_pattern || "")} onChange={(e) => update({ watch_pattern: e.target.value || undefined })} placeholder="**/*.pdf" />
        </BuilderField>
        <BuilderField label={t("workflows.fs_watch_batch_ms")} hint={t("workflows.fs_watch_batch_ms_hint")}>
          <input className="input input--sm" type="number" min={0} value={String(node.watch_batch_ms ?? 500)} onChange={(e) => update({ watch_batch_ms: parseInt(e.target.value) || 500 })} />
        </BuilderField>
      </BuilderRowPair>
    </>
  );
}

export const trigger_filesystem_watch_descriptor: FrontendNodeDescriptor = {
  node_type: "trigger_filesystem_watch",
  icon: "📁",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.trigger_filesystem_watch.label",
  category: "integration",
  output_schema: [
    { name: "files",        type: "array",  description: "node.trigger_filesystem_watch.output.files" },
    { name: "batch_id",     type: "string", description: "node.trigger_filesystem_watch.output.batch_id" },
    { name: "triggered_at", type: "string", description: "node.trigger_filesystem_watch.output.triggered_at" },
    { name: "watch_path",   type: "string", description: "node.trigger_filesystem_watch.output.watch_path" },
  ],
  input_schema: [],
  create_default: () => ({ trigger_type: "filesystem_watch", watch_path: "", watch_events: ["add"], watch_pattern: "", watch_batch_ms: 500 }),
  EditPanel: FilesystemWatchTriggerEditPanel,
};
