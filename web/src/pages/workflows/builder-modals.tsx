/**
 * Builder modal components — Phase, Cron, Trigger, Channel, OrcheNode, Agent editing.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useModalEffects, useConfirm } from "../../components/modal";
import { useT } from "../../i18n";
import { get_frontend_node } from "./node-registry";
import type { WorkflowDef, PhaseDef, AgentDef, CriticDef, OrcheNodeDef, TriggerNodeDef, RolePreset } from "./workflow-types";

type ChannelInstanceInfo = { instance_id: string; provider: string; label: string; enabled: boolean; running: boolean };
type BackendOption = { value: string; label: string };

const REJECTION_POLICIES = ["retry_all", "retry_targeted", "escalate"];

export function PhaseEditModal({ workflow, phaseId, onChange, onPhaseIdChange, onClose }: {
  workflow: WorkflowDef;
  phaseId: string;
  onChange: (w: WorkflowDef) => void;
  onPhaseIdChange?: (newId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (pi < 0) return null;
  const phase = workflow.phases[pi]!;

  const updatePhase = (patch: Partial<PhaseDef>) => {
    const oldId = phase.phase_id;
    const phases = [...workflow.phases];
    phases[pi] = { ...phases[pi]!, ...patch } as PhaseDef;
    let next: WorkflowDef = { ...workflow, phases };
    // phase_id 변경 시 모든 참조를 일괄 갱신
    if (patch.phase_id !== undefined && patch.phase_id !== oldId) {
      const newId = patch.phase_id;
      const rewrite = (ids?: string[]) => ids?.map((id) => (id === oldId ? newId : id));
      next = {
        ...next,
        phases: next.phases.map((p) =>
          p.depends_on?.includes(oldId)
            ? { ...p, depends_on: rewrite(p.depends_on) }
            : p,
        ),
        tool_nodes: next.tool_nodes?.map((t) =>
          t.attach_to?.includes(oldId)
            ? { ...t, attach_to: rewrite(t.attach_to) }
            : t,
        ),
        skill_nodes: next.skill_nodes?.map((s) =>
          s.attach_to?.includes(oldId)
            ? { ...s, attach_to: rewrite(s.attach_to) }
            : s,
        ),
      };
      onPhaseIdChange?.(newId);
    }
    onChange(next);
  };

  const removePhase = () => {
    onChange({ ...workflow, phases: workflow.phases.filter((_, i) => i !== pi) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-phase-title">
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-phase-title" className="modal__title">{phase.title || phase.phase_id}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.phase_id")}</label>
            <input autoFocus className="input input--sm" value={phase.phase_id} onChange={(e) => updatePhase({ phase_id: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_title")}</label>
            <input className="input input--sm" value={phase.title} onChange={(e) => updatePhase({ title: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_mode")}</label>
            <select
              className="input input--sm"
              value={phase.mode || "parallel"}
              onChange={(e) => updatePhase({ mode: e.target.value as PhaseDef["mode"] })}
            >
              <option value="parallel">{t("workflows.mode_parallel")}</option>
              <option value="interactive">{t("workflows.mode_interactive")}</option>
              <option value="sequential_loop">{t("workflows.mode_sequential_loop")}</option>
            </select>
          </div>
          {(phase.mode === "interactive" || phase.mode === "sequential_loop") && (
            <div className="builder-row">
              <label className="label">{t("workflows.max_loop_iterations")}</label>
              <input
                className="input input--sm"
                type="number"
                min={1}
                placeholder={phase.mode === "interactive" ? "20" : "50"}
                value={phase.max_loop_iterations ?? (phase.mode === "interactive" ? 20 : 50)}
                onChange={(e) => updatePhase({ max_loop_iterations: Number(e.target.value) || undefined })}
              />
              <span className="builder-hint">{t("workflows.loop_iterations_hint")}</span>
            </div>
          )}
          <div className="builder-meta-hint">
            {t("workflows.agents_count", { n: String(phase.agents.length) })}
            {phase.critic ? ` + ${t("workflows.critic")}` : ""}
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={removePhase} disabled={workflow.phases.length <= 1}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm" onClick={onClose}>
            {t("workflows.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cron 편집 모달 ──

/** @deprecated 하위 호환용. trigger_nodes로 대체됨. */
type TriggerDef = { type: "cron"; schedule: string; timezone?: string };

export function CronEditModal({ trigger, onChange, onRemove, onClose }: {
  trigger?: TriggerDef;
  onChange: (t: TriggerDef) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [schedule, setSchedule] = useState(trigger?.schedule || "0 9 * * *");
  const [timezone, setTimezone] = useState(trigger?.timezone || "");

  const handleSave = () => {
    const val: TriggerDef = { type: "cron", schedule };
    if (timezone) val.timezone = timezone;
    onChange(val);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-cron-title">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-cron-title" className="modal__title">{t("workflows.node_cron")}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.cron_schedule")}</label>
            <input autoFocus className="input input--sm" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.timezone")}</label>
            <input className="input input--sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Seoul" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => confirm(t("workflows.remove_confirm"), () => { onRemove(); onClose(); })}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
        {confirmDialog}
      </div>
    </div>
  );
}

// ── Trigger Node 편집 모달 ──

type TriggerType = "cron" | "webhook" | "manual" | "channel_message" | "kanban";
const TRIGGER_TYPES: TriggerType[] = ["cron", "webhook", "manual", "channel_message", "kanban"];
const TRIGGER_LABEL_KEYS: Record<TriggerType, string> = {
  cron: "workflows.trigger_cron", webhook: "workflows.trigger_webhook", manual: "workflows.trigger_manual", channel_message: "workflows.trigger_channel", kanban: "workflows.kanban_trigger",
};

export function TriggerNodeEditModal({ node, onChange, onRemove, onClose }: {
  node: TriggerNodeDef;
  onChange: (n: TriggerNodeDef) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [triggerType, setTriggerType] = useState<TriggerType>(node.trigger_type);
  const [schedule, setSchedule] = useState(node.schedule || "0 9 * * *");
  const [timezone, setTimezone] = useState(node.timezone || "");
  const [webhookPath, setWebhookPath] = useState(node.webhook_path || "");
  const [channelType, setChannelType] = useState(node.channel_type || "slack");
  const [chatId, setChatId] = useState(node.chat_id || "");
  const [boardId, setBoardId] = useState(node.board_id || "");
  const [actions, setActions] = useState((node.actions || []).join(","));
  const [columnId, setColumnId] = useState(node.column_id || "");

  const handleSave = () => {
    const updated: TriggerNodeDef = { id: node.id, trigger_type: triggerType };
    if (triggerType === "cron") { updated.schedule = schedule; if (timezone) updated.timezone = timezone; }
    if (triggerType === "webhook") { updated.webhook_path = webhookPath; }
    if (triggerType === "channel_message") { updated.channel_type = channelType; if (chatId) updated.chat_id = chatId; }
    if (triggerType === "kanban") {
      updated.board_id = boardId;
      if (actions) updated.actions = actions.split(",").map(a => a.trim()).filter(a => a);
      if (columnId) updated.column_id = columnId;
    }
    onChange(updated);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-trigger-title">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-trigger-title" className="modal__title">{t("workflows.trigger_node")}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.trigger_type")}</label>
            <div className="builder-btn-row">
              {TRIGGER_TYPES.map((tt) => (
                <button key={tt} className={`btn btn--sm${triggerType === tt ? " btn--accent" : ""}`}
                  onClick={() => setTriggerType(tt)}>{t(TRIGGER_LABEL_KEYS[tt])}</button>
              ))}
            </div>
          </div>
          {triggerType === "cron" && (<>
            <div className="builder-row">
              <label className="label">{t("workflows.cron_schedule")}</label>
              <input autoFocus className="input input--sm" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.timezone")}</label>
              <input className="input input--sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Seoul" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
          </>)}
          {triggerType === "webhook" && (
            <div className="builder-row">
              <label className="label">{t("workflows.webhook_path")}</label>
              <input autoFocus className="input input--sm" value={webhookPath} onChange={(e) => setWebhookPath(e.target.value)} placeholder="/hooks/my-workflow" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
          )}
          {triggerType === "channel_message" && (<>
            <div className="builder-row">
              <label className="label">{t("workflows.channel_type")}</label>
              <input autoFocus className="input input--sm" value={channelType} onChange={(e) => setChannelType(e.target.value)} placeholder="slack" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.channel_chat_id")}</label>
              <input className="input input--sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="C01234567" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
          </>)}
          {triggerType === "kanban" && (<>
            <div className="builder-row">
              <label className="label">{t("workflows.kanban_trigger_board_id")}<span className="label__required">*</span></label>
              <input autoFocus className="input input--sm" required value={boardId} onChange={(e) => setBoardId(e.target.value)} placeholder="board-id" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.kanban_trigger_actions")}</label>
              <input className="input input--sm" value={actions} onChange={(e) => setActions(e.target.value)} placeholder="created,moved" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
              <span className="builder-hint">{t("workflows.kanban_trigger_column_hint")}</span>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.kanban_trigger_column_id")}</label>
              <input className="input input--sm" value={columnId} onChange={(e) => setColumnId(e.target.value)} placeholder="todo, in_progress, done" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
            </div>
          </>)}
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => confirm(t("workflows.remove_confirm"), () => { onRemove(); onClose(); })}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
        {confirmDialog}
      </div>
    </div>
  );
}

// ── Channel 편집 모달 ──

type HitlChannelDef = { channel_type: string; chat_id?: string };

export function ChannelEditModal({ channel, onChange, onRemove, onClose, channels }: {
  channel?: HitlChannelDef;
  onChange: (c: HitlChannelDef) => void;
  onRemove: () => void;
  onClose: () => void;
  channels: ChannelInstanceInfo[];
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [selectedId, setSelectedId] = useState(channel ? `${channel.channel_type}:${channel.chat_id || ""}` : "");
  const [chatId, setChatId] = useState(channel?.chat_id || "");

  const handleSelect = (val: string) => {
    setSelectedId(val);
    const match = channels.find((c) => c.instance_id === val);
    if (match) {
      setChatId("");
    }
  };

  const handleSave = () => {
    const match = channels.find((c) => c.instance_id === selectedId);
    const channel_type = match?.provider || selectedId.split(":")[0] || "slack";
    const val: HitlChannelDef = { channel_type };
    if (chatId) val.chat_id = chatId;
    onChange(val);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-channel-title">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-channel-title" className="modal__title">{t("workflows.node_channel")}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.node_channel")}</label>
            <select autoFocus className="input input--sm" value={selectedId} onChange={(e) => handleSelect(e.target.value)}>
              <option value="">{t("workflows.select_default")}</option>
              {channels.map((ch) => (
                <option key={ch.instance_id} value={ch.instance_id}>
                  {ch.label} ({ch.provider}{ch.running ? "" : " - offline"})
                </option>
              ))}
            </select>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.chat_id")}</label>
            <input className="input input--sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="C1234567" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => confirm(t("workflows.remove_confirm"), () => { onRemove(); onClose(); })}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
        {confirmDialog}
      </div>
    </div>
  );
}

// ── 오케스트레이션 노드 편집 모달 ──

export function OrcheNodeEditModal({ workflow, nodeId, onChange, onClose, onNodeIdChange, nodeOptions }: {
  workflow: WorkflowDef;
  nodeId: string;
  onChange: (w: WorkflowDef) => void;
  onClose: () => void;
  onNodeIdChange?: (newId: string) => void;
  nodeOptions?: Record<string, unknown>;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const nodes = workflow.orche_nodes || [];
  const idx = nodes.findIndex((n) => n.node_id === nodeId);
  if (idx < 0) return null;
  const node = nodes[idx]!;

  const update = (patch: Partial<OrcheNodeDef>) => {
    const oldId = node.node_id;
    const updated = [...nodes];
    updated[idx] = { ...updated[idx]!, ...patch } as OrcheNodeDef;
    let next: WorkflowDef = { ...workflow, orche_nodes: updated };
    if (patch.node_id !== undefined && patch.node_id !== oldId) {
      const newId = patch.node_id;
      const rewrite = (ids?: string[]) => ids?.map((id) => (id === oldId ? newId : id));
      next = {
        ...next,
        phases: next.phases.map((p) =>
          p.depends_on?.includes(oldId) ? { ...p, depends_on: rewrite(p.depends_on) } : p,
        ),
        orche_nodes: next.orche_nodes?.map((n) =>
          n.depends_on?.includes(oldId) ? { ...n, depends_on: rewrite(n.depends_on) } : n,
        ),
        field_mappings: next.field_mappings?.map((m) => ({
          ...m,
          from_node: m.from_node === oldId ? newId : m.from_node,
          to_node: m.to_node === oldId ? newId : m.to_node,
        })),
      };
      onNodeIdChange?.(newId);
    }
    onChange(next);
  };

  const remove = () => {
    onChange({ ...workflow, orche_nodes: nodes.filter((_, i) => i !== idx) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-orche-title">
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-orche-title" className="modal__title">{node.node_type.toUpperCase()}: {node.title}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.node_id_label")}</label>
            <input autoFocus className="input input--sm" value={node.node_id} onChange={(e) => update({ node_id: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_title")}</label>
            <input className="input input--sm" value={node.title} onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.depends_on")}</label>
            <input
              className="input input--sm"
              value={(node.depends_on || []).join(", ")}
              onChange={(e) => update({ depends_on: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="node-1, phase-1"
            />
          </div>

          {/* 노드 타입별 편집 패널 — registry에서 조회 */}
          {(() => {
            const desc = get_frontend_node(node.node_type);
            return desc?.EditPanel
              ? <desc.EditPanel node={node as Record<string, unknown>} update={update as (p: Record<string, unknown>) => void} t={t} options={nodeOptions} />
              : null;
          })()}
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => confirm(t("workflows.remove_confirm"), remove)}>{t("workflows.remove_phase")}</button>
          <button className="btn btn--sm" onClick={onClose}>{t("workflows.close")}</button>
        </div>
        {confirmDialog}
      </div>
    </div>
  );
}

// ── 클러스터 Sub-node (Agent/Critic) 편집 모달 ──

export function AgentEditModal({ workflow, subNodeId, onChange, onClose, onSubNodeIdChange, backends }: {
  workflow: WorkflowDef;
  subNodeId: string;
  onChange: (w: WorkflowDef) => void;
  onClose: () => void;
  onSubNodeIdChange?: (newId: string) => void;
  backends?: BackendOption[];
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { data: roles } = useQuery<RolePreset[]>({
    queryKey: ["workflow-roles"],
    queryFn: () => api.get("/api/workflow/roles"),
    staleTime: 60_000,
  });

  // subNodeId 형식: "{phaseId}__{agentId}" 또는 "{phaseId}__critic"
  const sep = subNodeId.indexOf("__");
  if (sep < 0) return null;
  const phaseId = subNodeId.slice(0, sep);
  const subId = subNodeId.slice(sep + 2);
  const isCritic = subId === "critic";

  const phaseIdx = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (phaseIdx < 0) return null;
  const phase = workflow.phases[phaseIdx]!;

  if (isCritic) {
    if (!phase.critic) return null;
    const critic = phase.critic;
    const updateCritic = (patch: Partial<CriticDef>) => {
      const phases = [...workflow.phases];
      phases[phaseIdx] = { ...phase, critic: { ...critic, ...patch } };
      onChange({ ...workflow, phases });
    };
    return (
      <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-critic-title">
        <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <h3 id="modal-critic-title" className="modal__title">{t("workflows.critic")} — {phase.title}</h3>
            <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <div className="modal__body">
            <div className="builder-row-pair">
              <div className="builder-row">
                <label className="label">{t("workflows.backend")}</label>
                <select className="input input--sm" value={critic.backend} onChange={(e) => updateCritic({ backend: e.target.value })}>
                  {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.model")}</label>
                <input className="input input--sm" value={critic.model || ""} placeholder="auto" onChange={(e) => updateCritic({ model: e.target.value || undefined })} />
              </div>
            </div>
            <div className="builder-row-pair">
              <div className="builder-row">
                <label className="label">{t("workflows.gate_label")}</label>
                <select className="input input--sm" value={critic.gate ? "true" : "false"} onChange={(e) => updateCritic({ gate: e.target.value === "true" })}>
                  <option value="true">{t("workflows.gate_yes")}</option>
                  <option value="false">{t("workflows.gate_no")}</option>
                </select>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.on_rejection")}</label>
                <select className="input input--sm" value={critic.on_rejection || ""} onChange={(e) => updateCritic({ on_rejection: e.target.value || undefined })}>
                  <option value="">-</option>
                  {REJECTION_POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.system_prompt")}</label>
              <textarea className="input input--sm" rows={4} value={critic.system_prompt} onChange={(e) => updateCritic({ system_prompt: e.target.value })} />
            </div>
          </div>
          <div className="modal__footer">
            <button className="btn btn--sm" onClick={onClose}>{t("workflows.close")}</button>
          </div>
        </div>
      </div>
    );
  }

  // Agent 편집
  const agentIdx = phase.agents.findIndex((a) => a.agent_id === subId);
  if (agentIdx < 0) return null;
  const agent = phase.agents[agentIdx]!;

  const updateAgent = (patch: Partial<AgentDef>) => {
    const oldAgentId = agent.agent_id;
    const phases = [...workflow.phases];
    const agents = [...phase.agents];
    agents[agentIdx] = { ...agent, ...patch };
    phases[phaseIdx] = { ...phase, agents };
    onChange({ ...workflow, phases });
    if (patch.agent_id !== undefined && patch.agent_id !== oldAgentId) {
      onSubNodeIdChange?.(`${phaseId}__${patch.agent_id}`);
    }
  };

  const applyRole = (roleId: string) => {
    const preset = roles?.find((r) => r.id === roleId);
    if (!preset) { updateAgent({ role: roleId }); return; }
    const prompt_parts: string[] = [];
    if (preset.soul) prompt_parts.push(preset.soul);
    if (preset.heart) prompt_parts.push(preset.heart);
    updateAgent({
      role: preset.id,
      label: preset.name,
      system_prompt: prompt_parts.join("\n\n") || "",
      tools: preset.tools.length > 0 ? preset.tools : undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-agent-title">
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 id="modal-agent-title" className="modal__title">{t("workflows.agent_id")}: {agent.label || agent.agent_id}</h3>
          <button className="modal__close" onClick={onClose} aria-label={t("workflows.close")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="modal__body">
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.agent_id")}</label>
              <input autoFocus className="input input--sm" value={agent.agent_id} onChange={(e) => updateAgent({ agent_id: e.target.value })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.agent_label")}</label>
              <input className="input input--sm" value={agent.label} onChange={(e) => updateAgent({ label: e.target.value })} />
            </div>
          </div>
          {/* Role 태그 칩 선택 */}
          <div className="builder-row">
            <label className="label">{t("workflows.agent_role")}</label>
            <div className="role-chips">
              {roles?.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`role-chip${agent.role === r.id ? " role-chip--active" : ""}`}
                  onClick={() => applyRole(r.id)}
                  title={r.description}
                >
                  {r.name}
                </button>
              ))}
              <input
                className="role-chip-input"
                value={roles?.some((r) => r.id === agent.role) ? "" : agent.role}
                placeholder={t("workflows.custom_role")}
                onChange={(e) => updateAgent({ role: e.target.value })}
                onFocus={() => { if (roles?.some((r) => r.id === agent.role)) updateAgent({ role: "" }); }}
              />
            </div>
            {roles?.some((r) => r.id === agent.role) && (
              <div className="builder-accent-hint">
                {t("workflows.role_auto_prompt")}
              </div>
            )}
          </div>
          <div className="builder-row-triple">
            <div className="builder-row">
              <label className="label">{t("workflows.backend")}</label>
              <select className="input input--sm" value={agent.backend} onChange={(e) => updateAgent({ backend: e.target.value })}>
                {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.model")}</label>
              <input className="input input--sm" value={agent.model || ""} placeholder="auto" onChange={(e) => updateAgent({ model: e.target.value || undefined })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.max_turns")}</label>
              <div className="builder-inline-row">
                <input
                  className="input input--sm flex-1"
                  type="number"
                  min={0}
                  value={agent.max_turns ?? 3}
                  onChange={(e) => updateAgent({ max_turns: Number(e.target.value) })}
                  disabled={agent.max_turns === 0}
                />
                <label className="builder-checkbox-label">
                  <input
                    type="checkbox"
                    checked={agent.max_turns === 0}
                    onChange={(e) => updateAgent({ max_turns: e.target.checked ? 0 : 10 })}
                  />
                  {t("workflows.unlimited")}
                </label>
              </div>
              <span className="builder-hint">{t("workflows.max_turns_hint")}</span>
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.system_prompt")}</label>
            <div className="builder-accent-hint--mb">
              {t(`workflows.prompt_hint_${phase.mode || "parallel"}`)}
            </div>
            <textarea className="input input--sm" rows={5} value={agent.system_prompt} onChange={(e) => updateAgent({ system_prompt: e.target.value })} />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm" onClick={onClose}>{t("workflows.close")}</button>
        </div>
      </div>
    </div>
  );
}
